import { AppError } from "../core/app-error";
import { canonicalJson } from "../core/crypto";

const MAX_KLASSEN_DETAIL_RESPONSE_BYTES = 2_000_000;
const MAX_KLASSEN_DETAIL_TEXT_BYTES = 256_000;
const MAX_KLASSEN_DETAIL_SCHUELERLISTE_BYTES = 256_000;
const MAX_KLASSEN_DETAIL_SCHUELER = 20_000;

/** Vollstaendige, live bestaetigte Feldmenge der Klassen-Detailantwort. */
export const MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS = [
  "alter_ende",
  "alter_start",
  "benutzer",
  "beschreibung",
  "bildDa",
  "endzeit_h",
  "endzeit_m",
  "freiklasse",
  "id",
  "id_schulintern",
  "kapazitaet",
  "klassenende",
  "klassenfarbe",
  "klassenstart",
  "kurzname",
  "liveLink",
  "online",
  "probetraining_kontingent",
  "raum",
  "schueler_liste_sms",
  "schuelerliste",
  "schule",
  "sms30",
  "sms30Text",
  "sparte",
  "startzeit_h",
  "startzeit_m",
  "teilnehmerMax",
  "wochentag"
] as const;

/** Live bestaetigte Feldmenge eines Eintrags in `schuelerliste`. */
export const MATOOL_KLASSEN_SCHUELER_FIELDS = [
  "alter",
  "austritt",
  "bildlink",
  "nachname",
  "schueler_nr_schulintern",
  "vorname"
] as const;

const KLASSEN_DETAIL_FIELD_SET = new Set<string>(
  MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS
);
const KLASSEN_SCHUELER_FIELD_SET = new Set<string>(
  MATOOL_KLASSEN_SCHUELER_FIELDS
);
const KLASSEN_REQUIRED_STRING_FIELDS = new Set<string>([
  "liveLink",
  "schueler_liste_sms",
  "sms30Text"
]);

type KlassenDetailScalar = boolean | number | string | null;

export interface MatoolKlassenDetailRecord {
  payload: Record<string, KlassenDetailScalar>;
  sourceId: string;
}

/**
 * Validiert genau eine Klassenantwort. Alle Felder bleiben erhalten;
 * `schuelerliste` wird ohne Kuerzung als kanonisches JSON gespeichert; ein
 * Ueberschreiten der gemeinsamen Store-Grenze bricht sichtbar ab.
 */
export function parseKlassenDetailResponse(
  body: Uint8Array,
  expectedId?: string
): MatoolKlassenDetailRecord {
  if (
    body.byteLength === 0 ||
    body.byteLength > MAX_KLASSEN_DETAIL_RESPONSE_BYTES ||
    (expectedId !== undefined && !/^\d{1,64}$/u.test(expectedId))
  ) {
    throw klassenDetailSchemaError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
    );
  } catch {
    throw klassenDetailSchemaError();
  }

  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw klassenDetailSchemaError();
  }

  const source = parsed[0];
  const keys = Object.keys(source);
  if (
    keys.length !== MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS.length ||
    keys.some((key) => !KLASSEN_DETAIL_FIELD_SET.has(key)) ||
    MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS.some(
      (field) => !Object.hasOwn(source, field)
    )
  ) {
    throw klassenDetailSchemaError();
  }

  const sourceId = source.id;
  if (
    typeof sourceId !== "string" ||
    !/^\d{1,64}$/u.test(sourceId) ||
    (expectedId !== undefined && sourceId !== expectedId)
  ) {
    throw klassenDetailSchemaError();
  }

  const payload: Record<string, KlassenDetailScalar> = {};
  try {
    for (const field of MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS) {
      const value = source[field];
      if (field === "schuelerliste") {
        payload[field] = preserveSchuelerliste(value);
        continue;
      }
      if (
        (value !== null && typeof value !== "string") ||
        (KLASSEN_REQUIRED_STRING_FIELDS.has(field) &&
          typeof value !== "string") ||
        (typeof value === "string" && !isBoundedText(value))
      ) {
        throw klassenDetailSchemaError();
      }
      payload[field] = value;
    }
  } catch {
    throw klassenDetailSchemaError();
  }

  return { payload, sourceId };
}

function preserveSchuelerliste(value: unknown): string {
  if (
    !Array.isArray(value) ||
    value.length > MAX_KLASSEN_DETAIL_SCHUELER
  ) {
    throw klassenDetailSchemaError();
  }

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      throw klassenDetailSchemaError();
    }
    const keys = Object.keys(candidate);
    if (
      keys.length !== MATOOL_KLASSEN_SCHUELER_FIELDS.length ||
      keys.some((key) => !KLASSEN_SCHUELER_FIELD_SET.has(key)) ||
      MATOOL_KLASSEN_SCHUELER_FIELDS.some(
        (field) => !Object.hasOwn(candidate, field)
      )
    ) {
      throw klassenDetailSchemaError();
    }
    for (const field of MATOOL_KLASSEN_SCHUELER_FIELDS) {
      if (!isBoundedJsonScalar(candidate[field])) {
        throw klassenDetailSchemaError();
      }
    }
  }

  const serialized = canonicalJson(value);
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_KLASSEN_DETAIL_SCHUELERLISTE_BYTES
  ) {
    throw klassenDetailSchemaError();
  }
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedJsonScalar(value: unknown): value is KlassenDetailScalar {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" && isBoundedText(value);
}

function isBoundedText(value: string): boolean {
  return (
    new TextEncoder().encode(value).byteLength <=
    MAX_KLASSEN_DETAIL_TEXT_BYTES
  );
}

function klassenDetailSchemaError(): AppError {
  return new AppError(
    "matool_klassen_detail_schema_mismatch",
    502,
    "Die MATOOL-Klassendetails entsprechen nicht dem bestaetigten Schema."
  );
}
