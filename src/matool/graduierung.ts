import { AppError } from "../core/app-error";
import {
  describeJsonShape,
  MatoolShapeMismatchError
} from "./response-shape";

export interface MatoolGraduierungRecord {
  payload: Record<string, boolean | string>;
  sourceId: string;
}

const MAX_GRADUIERUNGEN_PER_MEMBER = 500;
const MAX_VALUE_LENGTH = 500;

/**
 * Die bestätigte MaTool-Antwort enthält je Mitglied dessen Graduierungs-
 * Historie. Ein Eintrag mit datum="sparte" ist nur Metadaten für die
 * Auswahlliste und wird bewusst nicht als Prüfung an Zapier weitergegeben.
 */
export function parseGraduierungResponse(
  body: Uint8Array,
  memberId: string
): MatoolGraduierungRecord[] {
  if (!/^\d{1,32}$/u.test(memberId)) {
    throw graduierungSchemaError(undefined);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
    );
  } catch {
    throw graduierungSchemaError(undefined);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_GRADUIERUNGEN_PER_MEMBER) {
    throw graduierungSchemaError(parsed);
  }

  const records: MatoolGraduierungRecord[] = [];
  const sourceIds = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw graduierungSchemaError(parsed);
    }
    const source = entry as Record<string, unknown>;
    if (source.datum === "sparte") {
      continue;
    }
    const recordId = numericId(source.id);
    const graduierungId = numericId(source.graduierungid);
    const date = germanDate(source.datum);
    const graduierung = safeText(source.graduierung);
    const sparte = safeText(source.sparte);
    const cancelled = booleanStorno(source.storno);
    const linkPdf = source.link_pdf;
    if (
      !recordId ||
      !graduierungId ||
      !date ||
      graduierung === undefined ||
      sparte === undefined ||
      cancelled === undefined ||
      typeof linkPdf !== "string" ||
      linkPdf.length > MAX_VALUE_LENGTH
    ) {
      throw graduierungSchemaError(parsed);
    }
    const sourceId = `g_${memberId}_${recordId}`;
    if (sourceIds.has(sourceId)) {
      throw graduierungSchemaError(parsed);
    }
    sourceIds.add(sourceId);
    records.push({
      payload: {
        graduierung: graduierung,
        graduierung_id: graduierungId,
        mitglied_id: memberId,
        pdf_verfuegbar: linkPdf.trim() !== "" && linkPdf !== "&nbsp;",
        pruefungsdatum: date,
        sparte,
        storniert: cancelled
      },
      sourceId
    });
  }
  return records.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function numericId(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{1,32}$/u.test(value)) {
    return value;
  }
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    const normalized = String(value);
    return /^\d{1,32}$/u.test(normalized) ? normalized : undefined;
  }
  return undefined;
}

function germanDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, day, month, year] = match;
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return candidate.getUTCFullYear() === Number(year) &&
    candidate.getUTCMonth() === Number(month) - 1 &&
    candidate.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : undefined;
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= MAX_VALUE_LENGTH ? normalized : undefined;
}

function booleanStorno(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === "0") {
    return false;
  }
  return undefined;
}

function graduierungSchemaError(value: unknown): MatoolShapeMismatchError {
  return new MatoolShapeMismatchError(
    new AppError(
      "matool_graduierung_schema_mismatch",
      502,
      "Die MATOOL-Graduierungsdaten entsprechen nicht dem bestätigten Schema."
    ),
    {
      area: "graduierungen",
      ...(value === undefined ? {} : { json: describeJsonShape(value) })
    }
  );
}
