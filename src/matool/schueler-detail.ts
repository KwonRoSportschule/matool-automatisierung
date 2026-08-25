import { AppError } from "../core/app-error";
import { canonicalJson } from "../core/crypto";
import type { MatoolSafeAreaRecord } from "./client";
import {
  describeJsonShape,
  MatoolShapeMismatchError,
  type JsonShape
} from "./response-shape";

const MAX_SCHUELER_DETAIL_RESPONSE_BYTES = 2_000_000;
const MAX_SCHUELER_DETAIL_COMPLEX_VALUE_BYTES = 256_000;
const MAX_SCHUELER_DETAIL_PAYLOAD_BYTES = 512_000;
const MAX_SCHUELER_DETAIL_STRING_LENGTH = 256_000;

/** Vollstaendige, live bestaetigte Feldmenge der Schueler-Detailantwort. */
export const MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS = [
  "abschluss",
  "abweichenderEinzug",
  "anmeldegebuehr",
  "anrede",
  "autPreisArt",
  "autPreisDatum",
  "autPreisTurnus",
  "autPreisWert",
  "bank",
  "barcode",
  "beitrag",
  "beruf",
  "bic",
  "blz",
  "eltern_anrede",
  "eltern_geburtstag",
  "eltern_nachname",
  "eltern_ort",
  "eltern_plz",
  "eltern_strasse",
  "eltern_telefon",
  "eltern_vorname",
  "email",
  "ewto",
  "familienBande",
  "geburtsort",
  "geburtstag",
  "geocode",
  "gueltig_bis",
  "handy",
  "iban",
  "jahresgebuehr",
  "jahresgebuehr_halbjahr",
  "jahresgebuehrdatum",
  "karte_name",
  "karte_preis",
  "kartenoffen",
  "kategorienliste",
  "klassenliste",
  "konto",
  "kontoinhaber",
  "kuendigungsfrist",
  "kundenart",
  "mandatsreferenz",
  "memo",
  "mitgliednr",
  "name",
  "nationalitaet",
  "plz",
  "prowoche",
  "pruefung_ohnegebuehr",
  "schueler_nr",
  "schule",
  "sifu",
  "spartenliste",
  "stadt",
  "strasse",
  "telefon",
  "verlaengerung",
  "vertrag",
  "vertragid",
  "vertragsbeginn",
  "vertragsdatum",
  "vertragsende",
  "vname",
  "zahlart",
  "zahlungsperiode"
] as const;

const MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELD_SET = new Set<string>(
  MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS
);

/**
 * Validiert eine Schueler-Detailantwort strikt gegen das live bestaetigte
 * Schema. Komplexe Werte bleiben vollstaendig als kanonisches JSON erhalten.
 */
export function parseSchuelerDetailResponse(
  body: Uint8Array,
  expectedId: string
): MatoolSafeAreaRecord {
  let parsedForDiagnosis: unknown;
  let jsonGelesen = false;
  try {
    return parseSchuelerDetail(body, expectedId, (parsed) => {
      parsedForDiagnosis = parsed;
      jsonGelesen = true;
    });
  } catch (error) {
    // Ein blosses "passt nicht" hilft niemandem weiter. Die beobachtete Form
    // wird deshalb mitgegeben -- Typen, Verschachtelung und Feldnamen, aber
    // kein einziger Wert.
    if (
      error instanceof AppError &&
      !(error instanceof MatoolShapeMismatchError)
    ) {
      throw new MatoolShapeMismatchError(error, {
        area: "schueler_details",
        json: jsonGelesen
          ? describeJsonShape(parsedForDiagnosis)
          : describeUnparsedBody(body)
      });
    }
    throw error;
  }
}

/**
 * Laesst sich die Antwort gar nicht als JSON lesen, wird nur festgehalten,
 * womit sie beginnt und wie gross sie ist. Damit ist unterscheidbar, ob
 * MATOOL eine Fehlerseite, HTML oder etwas anderes geliefert hat.
 */
function describeUnparsedBody(body: Uint8Array): JsonShape {
  const anfang = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false })
    .decode(body.slice(0, 16))
    .trimStart()
    .slice(0, 1);
  const art =
    anfang === "<"
      ? "beginnt-mit-spitzklammer"
      : anfang === "{" || anfang === "["
        ? "beginnt-wie-json"
        : anfang.length === 0
          ? "leer"
          : "anderer-anfang";
  return { keys: [art], kind: "string", length: body.byteLength };
}

function parseSchuelerDetail(
  body: Uint8Array,
  expectedId: string,
  onParsed: (parsed: unknown) => void
): MatoolSafeAreaRecord {
  if (
    body.byteLength === 0 ||
    body.byteLength > MAX_SCHUELER_DETAIL_RESPONSE_BYTES ||
    !/^\d{1,32}$/u.test(expectedId)
  ) {
    throw schuelerDetailSchemaError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
    );
  } catch {
    throw schuelerDetailSchemaError();
  }
  onParsed(parsed);

  const candidates = collectSchuelerDetailCandidates(parsed);
  if (candidates.length !== 1) {
    throw schuelerDetailSchemaError();
  }
  const candidate = candidates[0];
  if (!isRecord(candidate)) {
    throw schuelerDetailSchemaError();
  }

  const keys = Object.keys(candidate);
  if (
    keys.length !== MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS.length ||
    keys.some((key) => !MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELD_SET.has(key)) ||
    MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS.some(
      (field) => !Object.hasOwn(candidate, field)
    )
  ) {
    throw schuelerDetailSchemaError();
  }

  const sourceId = scalarSchuelerId(candidate.schueler_nr);
  if (sourceId !== expectedId) {
    throw schuelerDetailSchemaError();
  }

  const payload: Record<string, boolean | number | string | null> = {};
  try {
    for (const field of MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS) {
      payload[field] = preserveSchuelerDetailValue(candidate[field]);
    }
    if (
      new TextEncoder().encode(canonicalJson(payload)).byteLength >
      MAX_SCHUELER_DETAIL_PAYLOAD_BYTES
    ) {
      throw schuelerDetailSchemaError();
    }
  } catch {
    throw schuelerDetailSchemaError();
  }

  return { payload, sourceId: expectedId };
}

function collectSchuelerDetailCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return [];
  }
  return Object.values(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalarSchuelerId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^\d{1,32}$/u.test(value) ? value : undefined;
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

function preserveSchuelerDetailValue(
  value: unknown
): boolean | number | string | null {
  if (
    value === null ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_SCHUELER_DETAIL_STRING_LENGTH) {
      throw schuelerDetailSchemaError();
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw schuelerDetailSchemaError();
    }
    return value;
  }
  if (Array.isArray(value) || isRecord(value)) {
    const serialized = canonicalJson(value);
    if (
      new TextEncoder().encode(serialized).byteLength >
      MAX_SCHUELER_DETAIL_COMPLEX_VALUE_BYTES
    ) {
      throw schuelerDetailSchemaError();
    }
    return serialized;
  }
  throw schuelerDetailSchemaError();
}

function schuelerDetailSchemaError(): AppError {
  return new AppError(
    "matool_schueler_detail_schema_mismatch",
    502,
    "Die MATOOL-Schuelerdetails entsprechen nicht dem bestaetigten Schema."
  );
}
