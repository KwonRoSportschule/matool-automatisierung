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
  headerNamesByColumnCount?: Record<string, string[]>;
  json?: JsonShape;
  rowCount?: number;
  rowShapes?: SafeAreaRowShape[];
  topLevelRowCount?: number;
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
    this.shape = shape;
  }
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
