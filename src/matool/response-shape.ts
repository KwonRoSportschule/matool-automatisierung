import { AppError } from "../core/app-error";

/**
 * Beschreibt den Aufbau einer MATOOL-Antwort, ohne ihren Inhalt.
 *
 * Enthalten sind ausschliesslich Zaehlwerte, Typen und Feldnamen. Werte
 * werden bewusst nicht uebernommen, damit die Diagnose keine Personendaten
 * fuehrt. Reine Ziffernschluessel werden zusaetzlich zu "#" verkuerzt, weil
 * sie Kennungen sein koennen.
 */
/** Form einer Tabellenzeile, verdichtet auf ihre Zaehlwerte. */
export interface SafeAreaRowShape {
  hasStableId: boolean;
  header: boolean;
  nestedRowCount: number;
  nonEmptyCellCount: number;
  occurrences: number;
  schuelerActionCandidateCount: number;
  tdCount: number;
  thCount: number;
  topLevel: boolean;
}

export interface MatoolResponseShape {
  area: string;
  truncated?: true;
  pagination?: SafeAreaPaginationShape;
  headerNamesByColumnCount?: Record<string, string[]>;
  json?: JsonShape;
  rowCount?: number;
  rowShapes?: SafeAreaRowShape[];
  topLevelRowCount?: number;
}

/** Only structural flags and page numbers; never URLs, IDs or query values. */
export interface SafeAreaPaginationShape {
  detected: boolean;
  invalidElement: boolean;
  linkCount: number;
  offsets: number[];
  links: Array<{
    expectedLocation: boolean;
    queryKeys: string[];
    queryKeyCount: number;
    duplicateQueryKeys: boolean;
    offsetState: "absent" | "valid" | "other";
    show: "absent" | "valid" | "other";
    todo: "absent" | "valid" | "other";
    exFilter: "absent" | "show" | "other";
    valid: boolean;
    occurrences: number;
  }>;
  omittedLinkShapes: number;
  invalidLinkCount: number;
  selectedCount: number;
  selectedPageNumbers: number[];
  requestedOffset?: number;
  parsedRecordCount?: number;
  stage?: "rows" | "nonempty" | "pagination" | "page_set" | "selected_page" | "merge";
}

export interface JsonShape {
  entries?: Record<string, JsonShape>;
  itemShape?: JsonShape;
  keyCount?: number;
  keys?: string[];
  kind:
    | "array"
    | "boolean"
    | "null"
    | "number"
    | "object"
    | "string"
    | "undefined";
  length?: number;
}

/** Fehler, der die beobachtete Form mitfuehrt, damit sie belegbar wird. */
export class MatoolShapeMismatchError extends AppError {
  readonly shape: MatoolResponseShape;

  constructor(cause: AppError, shape: MatoolResponseShape) {
    super(cause.code, cause.status, cause.message);
    this.name = "MatoolShapeMismatchError";
    this.shape = boundResponseShape(shape);
  }
}

// Diagnostic headers are not trusted data: an unexpected header may contain a
// person's name. Keep only confirmed generic field labels, never arbitrary text.
const DIAGNOSTIC_HEADER_NAMES = new Set([
  "nr", "datum", "vorname", "name", "status", "vertrag", "bezeichnung",
  "artikel", "anzahl", "bestand", "preis", "betrag", "typ", "datei",
  "download", "betreff", "kategorie", "klasse", "email", "telefon", "handy",
  "quelle", "kontakt", "probetraining", "ergebnis", "anrede"
]);
const MAX_RESPONSE_SHAPE_BYTES = 15_500;

/** Keep diagnostics below the store's 16,000-character limit, also in UTF-8. */
function boundResponseShape(shape: MatoolResponseShape): MatoolResponseShape {
  const result: MatoolResponseShape = {
    ...shape,
    ...(shape.headerNamesByColumnCount ? {
      headerNamesByColumnCount: Object.fromEntries(
        Object.entries(shape.headerNamesByColumnCount).map(([count, names]) => [
          count, names.map((name) => DIAGNOSTIC_HEADER_NAMES.has(name) ? name : "<other>")
        ])
      )
    } : {})
  };
  const fits = () => new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_RESPONSE_SHAPE_BYTES;
  if (fits()) return result;
  result.truncated = true;
  delete result.headerNamesByColumnCount;
  if (fits()) return result;
  if (result.json) {
    result.json = {
      kind: result.json.kind,
      ...(result.json.keyCount === undefined ? {} : { keyCount: result.json.keyCount }),
      ...(result.json.length === undefined ? {} : { length: result.json.length })
    };
  }
  if (fits()) return result;
  delete result.rowShapes;
  if (fits()) return result;
  if (result.pagination) {
    result.pagination = { ...result.pagination, links: [...result.pagination.links] };
    while (result.pagination.links.length > 0 && !fits()) {
      result.pagination.links.pop();
      result.pagination.omittedLinkShapes += 1;
    }
  }
  if (fits()) return result;
  // Defensive final fallback for callers supplying a shape outside the bounded
  // parser contract. Never let an oversized diagnostic hide the original error.
  return { area: shape.area.slice(0, 64), truncated: true };
}

const MAX_REPORTED_KEYS = 100;
const MAX_JSON_SHAPE_DEPTH = 4;
const MAX_REPORTED_ENTRIES = 4;

/** Bildet den Aufbau eines JSON-Werts ab, ohne einen einzigen Wert zu nennen. */
export function describeJsonShape(value: unknown, depth = 0): JsonShape {
  if (value === null) {
    return { kind: "null" };
  }
  if (Array.isArray(value)) {
    const shape: JsonShape = { kind: "array", length: value.length };
    if (depth < MAX_JSON_SHAPE_DEPTH && value.length > 0) {
      shape.itemShape = describeJsonShape(value[0], depth + 1);
    }
    return shape;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const shape: JsonShape = {
      keyCount: keys.length,
      keys: keys.slice(0, MAX_REPORTED_KEYS).map(maskNumericKey),
      kind: "object"
    };
    if (depth < MAX_JSON_SHAPE_DEPTH) {
      const entries: Record<string, JsonShape> = {};
      for (const key of keys.slice(0, MAX_REPORTED_ENTRIES)) {
        entries[maskNumericKey(key)] = describeJsonShape(
          (value as Record<string, unknown>)[key],
          depth + 1
        );
      }
      shape.entries = entries;
    }
    return shape;
  }
  if (typeof value === "string") {
    return { kind: "string", length: value.length };
  }
  if (typeof value === "boolean") {
    return { kind: "boolean" };
  }
  if (typeof value === "number") {
    return { kind: "number" };
  }
  return { kind: "undefined" };
}

/**
 * Ein Schluessel aus reinen Ziffern ist vermutlich eine Kennung und keine
 * Feldbezeichnung. Er wird deshalb nicht mitgeschrieben.
 */
function maskNumericKey(key: string): string {
  if (/^\d+$/u.test(key)) {
    return "#";
  }
  return key.slice(0, 64);
}
