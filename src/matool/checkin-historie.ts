import { AppError } from "../core/app-error";
import type { MatoolSafeAreaRecord } from "./client";
import {
  describeJsonShape,
  MatoolShapeMismatchError
} from "./response-shape";

/**
 * Feste Feldmenge des Check-in-Verlaufs. Je Mitglied genau ein Datensatz,
 * auch ohne einen einzigen Check-in -- sonst liesse sich nicht unterscheiden,
 * ob ein Mitglied noch nie gelesen wurde oder nie eingecheckt hat.
 */
export const MATOOL_CHECKIN_HISTORIE_PAYLOAD_FIELDS = [
  "anzahl",
  "checkin_daten",
  "letzter_checkin",
  "mitglied_id"
] as const;

const MAX_CHECKINS_PER_MEMBER = 10_000;
const ALLOWED_ENTRY_FIELDS = new Set([
  "id",
  "klasse",
  "name",
  "timestamp",
  "wochentag"
]);

/**
 * Liest den vollstaendigen Check-in-Verlauf eines Mitglieds aus
 * `checkin_daten.php` (HAR vom 07.10.2026). Uebernommen wird nur das Datum
 * jedes Check-ins -- kein Name, keine Klasse, keine Uhrzeit. Eintraege mit
 * 00:00:00 sind nachgetragene Check-ins und zaehlen mit (anders als in der
 * Wochenansicht, wo 00:00:00 "nicht eingecheckt" bedeutet).
 */
export function parseCheckinHistorieResponse(
  body: Uint8Array,
  memberId: string
): MatoolSafeAreaRecord {
  if (!/^\d{1,32}$/u.test(memberId)) {
    throw checkinHistorieSchemaError(undefined);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)
    );
  } catch {
    throw checkinHistorieSchemaError(undefined);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_CHECKINS_PER_MEMBER) {
    throw checkinHistorieSchemaError(parsed);
  }

  const dates: string[] = [];
  const entryIds = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw checkinHistorieSchemaError(parsed);
    }
    const source = entry as Record<string, unknown>;
    if (Object.keys(source).some((key) => !ALLOWED_ENTRY_FIELDS.has(key))) {
      throw checkinHistorieSchemaError(parsed);
    }
    const entryId = typeof source.id === "string" ? source.id : undefined;
    const date = timestampDate(source.timestamp);
    if (!entryId || !/^\d{1,32}$/u.test(entryId) || !date || entryIds.has(entryId)) {
      throw checkinHistorieSchemaError(parsed);
    }
    entryIds.add(entryId);
    dates.push(date);
  }

  // Neueste zuerst; ein Tag mit zwei Check-ins zaehlt zweimal.
  dates.sort((left, right) => right.localeCompare(left));
  return {
    payload: {
      anzahl: dates.length,
      checkin_daten: JSON.stringify(dates),
      letzter_checkin: dates[0] ?? null,
      mitglied_id: memberId
    },
    sourceId: memberId
  };
}

/** "30.09.2026 - 18:30:48" -> "2026-09-30" */
function timestampDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match =
    /^(\d{2})\.(\d{2})\.(\d{4}) - (\d{2}):(\d{2}):(\d{2})$/u.exec(value.trim());
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

function checkinHistorieSchemaError(value: unknown): MatoolShapeMismatchError {
  return new MatoolShapeMismatchError(
    new AppError(
      "matool_checkin_historie_schema_mismatch",
      502,
      "Der MATOOL-Check-in-Verlauf entspricht nicht dem bestätigten Schema."
    ),
    {
      area: "checkin_historie",
      ...(value === undefined ? {} : { json: describeJsonShape(value) })
    }
  );
}
