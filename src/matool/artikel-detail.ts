import { AppError } from "../core/app-error";
import type { MatoolSafeAreaRecord } from "./client";

const MAX_ARTIKEL_DETAIL_RESPONSE_BYTES = 64_000;
const MAX_ARTIKEL_DETAIL_VALUE_LENGTH = 2_000;

export const MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS = [
  "artikel_nr",
  "beschreibung",
  "bezeichnung",
  "brutto_vk",
  "id",
  "lieferant",
  "memo",
  "mwstsatz",
  "netto_ek",
  "soll_bestand"
] as const;

const MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELD_SET = new Set<string>(
  MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS
);

type ArtikelDetailScalar = boolean | number | string | null;

export function parseArtikelDetailResponse(
  body: Uint8Array,
  expectedId: string
): MatoolSafeAreaRecord {
  if (
    body.byteLength === 0 ||
    body.byteLength > MAX_ARTIKEL_DETAIL_RESPONSE_BYTES ||
    !/^\d{1,64}$/u.test(expectedId)
  ) {
    throw artikelDetailSchemaError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
    );
  } catch {
    throw artikelDetailSchemaError();
  }

  const candidates = collectArtikelDetailCandidates(parsed);
  if (candidates.length !== 1) {
    throw artikelDetailSchemaError();
  }

  const candidate = candidates[0];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw artikelDetailSchemaError();
  }

  const source = candidate as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS.length ||
    keys.some((key) => !MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELD_SET.has(key))
  ) {
    throw artikelDetailSchemaError();
  }

  const payload: Record<string, ArtikelDetailScalar> = {};
  for (const field of MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS) {
    const value = source[field];
    if (!isAllowedArtikelDetailValue(value)) {
      throw artikelDetailSchemaError();
    }
    payload[field] = value;
  }

  const sourceId = toArtikelDetailSourceId(payload.id);
  if (!sourceId || sourceId !== expectedId) {
    throw artikelDetailSchemaError();
  }

  return { payload, sourceId };
}

function collectArtikelDetailCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  return Object.values(parsed as Record<string, unknown>);
}

function isAllowedArtikelDetailValue(
  value: unknown
): value is ArtikelDetailScalar {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return (
    typeof value === "string" &&
    value.length <= MAX_ARTIKEL_DETAIL_VALUE_LENGTH
  );
}

function toArtikelDetailSourceId(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{1,64}$/u.test(value)) {
    return value;
  }
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  return undefined;
}

function artikelDetailSchemaError(): AppError {
  return new AppError(
    "matool_artikel_detail_schema_mismatch",
    502,
    "Die MATOOL-Artikeldetails entsprechen nicht dem bestaetigten Schema."
  );
}
