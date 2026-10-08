import { AppError } from "../core/app-error";
import { DEFAULT_SCHULEN } from "../core/beitraege";
import type { Env } from "../worker/env";
import { storedPayloadCipher } from "../worker/payload-encryption";
import {
  EXAM_LOCATIONS,
  EXAM_PROGRAMS,
  type ExamListRow,
  type ExamLocation,
  type ExamProgram
} from "./xlsx";

interface StoredSnapshotRow {
  area: string;
  payload_json: string;
  source_id: string;
}

interface StoredPayload {
  area: string;
  payload: Record<string, unknown>;
  sourceId: string;
}

interface GraduationRecord {
  date: string;
  graduation: string;
  graduationId: string;
}

interface CheckinHistory {
  dates: readonly string[];
  last: string | null;
}

interface ProgramBelt {
  /** MATOOL-Kennung der Graduierung (graduierungen_schule, HAR 07.10.2026). */
  id: string;
  /** Wortlaut in MATOOL. */
  label: string;
  /** Text der Gruppe "Prüfung zum …" in der Liste. */
  examLabel: string;
}

interface ProgramRules {
  belts: readonly ProgramBelt[];
  /** Check-ins, die ab der aktuellen Graduierung bis zur nächsten nötig sind. */
  requiredCheckins: (currentBeltIndex: number | null) => number;
  /** MATOOL-Kennung der Sparte in schueler_daten.php → spartenliste. */
  spartenId: string;
  /** Gruppe nach der höchsten Graduierung der Sparte. */
  transition: string;
}

export interface ExamListDataset {
  /** Mitglieder der Liste, deren Stammdaten noch nie gelesen wurden. */
  pendingMembers: number;
  rows: ReadonlyMap<ExamProgram, readonly ExamListRow[]>;
  unresolvedLocations: ReadonlyMap<ExamProgram, number>;
}

function belts(
  entries: readonly (readonly [id: string, label: string])[],
  examLabel: (label: string) => string = (label) => label
): ProgramBelt[] {
  return entries.map(([id, label]) => ({ examLabel: examLabel(label), id, label }));
}

/**
 * Sparten, Gurtfolgen und Check-in-Vorgaben der Kinderprogramme. Kennungen
 * aus der MATOOL-Mitgliederansicht (HAR vom 07.10.2026); Vorgaben laut
 * Schulleitung: Panda-Kids 18 und Tiger-Kids 12 Check-ins je Gurt,
 * Warrior-Tigers ab 10.–7. Kup 12, ab 6. und 5. Kup 32, ab 4.–1. Kup 36
 * (Prüfung zum 5. Kup seit 08.10.2026 mit 32 statt 12).
 */
export const EXAM_PROGRAM_RULES: Readonly<Record<ExamProgram, ProgramRules>> = {
  "panda-kids": {
    belts: belts([
      ["590", "PK Weißgurt"],
      ["589", "PK Gelbgurt"],
      ["758", "PK Orangegurt"],
      ["759", "PK Grüngurt"],
      ["760", "PK Blaugurt"],
      ["761", "PK Rotgurt"],
      ["762", "PK Violettgurt"],
      ["763", "PK Schwarzgurt"]
    ]),
    requiredCheckins: () => 18,
    spartenId: "1017",
    transition: "Wechsel zu Tiger-Kids"
  },
  "tiger-kids": {
    belts: belts([
      ["601", "TK Weißgurt"],
      ["600", "TK Weiß-Gelbgurt"],
      ["597", "TK Gelbgurt"],
      ["596", "TK Gelb-Orangegurt"],
      ["764", "TK Orangegurt"],
      ["765", "TK Orange-Grüngurt"],
      ["15639", "TK Grüngurt"]
    ]),
    requiredCheckins: () => 12,
    spartenId: "194",
    transition: "Wechsel zu Warrior-Tigers"
  },
  "warrior-tigers": {
    belts: belts(
      [
        ["12076", "WT 10. Kup"],
        ["12077", "WT 9. Kup"],
        ["12078", "WT 8. Kup"],
        ["12079", "WT 7. Kup"],
        ["12080", "WT 6. Kup"],
        ["12081", "WT 5. Kup"],
        ["12082", "WT 4. Kup"],
        ["12083", "WT 3. Kup"],
        ["12084", "WT 2. Kup"],
        ["12085", "WT 1. Kup"]
      ],
      (label) => label.replace(/^WT\s+/u, "")
    ),
    requiredCheckins: (index) => {
      // Index 0 = 10. Kup; ohne Prüfung gilt die Vorgabe für den 10. Kup.
      const kup = 10 - (index ?? 0);
      if (kup >= 7) return 12;
      if (kup >= 5) return 32;
      return 36;
    },
    spartenId: "4825",
    transition: "Wechsel zu TKD Jugend-Erwachsene"
  }
};

/**
 * Baut die Zeilen aller Prüfungslisten ausschließlich aus den geschützten
 * Hub-Daten des stündlichen Abrufs (Mitgliederliste, Stammdaten,
 * Graduierungen, Check-in-Verlauf). MATOOL wird dabei nicht abgefragt, D1
 * nicht beschrieben. Ein unklarer Standort bricht weiterhin ab, damit kein
 * Kind still im falschen Standortblatt landet.
 */
export async function loadExamListDataset(env: Env): Promise<ExamListDataset> {
  const stored = await readStoredPayloads(env);
  const roster = payloadMap(stored, "schueler");
  if (roster.size === 0) {
    throw new AppError(
      "exam_list_roster_empty",
      409,
      "Der Hub hat noch keinen Mitgliederbestand gespeichert. Bitte zuerst einen MATOOL-Abruf abschließen."
    );
  }

  const details = payloadMap(stored, "schueler_details");
  const graduations = graduationMap(stored);
  const histories = checkinHistoryMap(stored);
  const rows = new Map<ExamProgram, ExamListRow[]>(
    EXAM_PROGRAMS.map((program) => [program, []])
  );
  const missingLocations: Record<ExamProgram, number> = {
    "panda-kids": 0,
    "tiger-kids": 0,
    "warrior-tigers": 0
  };
  let pendingMembers = 0;

  for (const [sourceId, member] of roster) {
    const detail = details.get(sourceId);
    if (!detail) {
      pendingMembers += 1;
      continue;
    }
    const sparten = new Set(collectText(detail.spartenliste));
    const programs = EXAM_PROGRAMS.filter((program) =>
      sparten.has(EXAM_PROGRAM_RULES[program].spartenId)
    );
    if (programs.length === 0) {
      continue;
    }
    const location = memberLocation(detail);
    const firstName = text(member.vorname) ?? text(detail.vname);
    const lastName = text(member.name) ?? text(detail.name);
    const history = histories.get(sourceId) ?? null;
    const contractStart = isoFromGerman(detail.vertragsbeginn);

    for (const program of programs) {
      if (!location) {
        missingLocations[program] += 1;
        continue;
      }
      if (!firstName || !lastName) {
        throw incompleteMemberData();
      }
      rows.get(program)?.push(
        buildRow({
          contractStart,
          firstName,
          graduations: graduations.get(sourceId) ?? [],
          history,
          lastName,
          location,
          program
        })
      );
    }
  }

  return {
    pendingMembers,
    rows,
    unresolvedLocations: new Map(
      EXAM_PROGRAMS.map((program) => [program, missingLocations[program]])
    )
  };
}

function buildRow(input: {
  contractStart: string | null;
  firstName: string;
  graduations: readonly GraduationRecord[];
  history: CheckinHistory | null;
  lastName: string;
  location: ExamLocation;
  program: ExamProgram;
}): ExamListRow {
  const rules = EXAM_PROGRAM_RULES[input.program];
  const current = currentBelt(rules, input.graduations);
  const nextIndex = current ? current.index + 1 : 0;
  const nextBelt = rules.belts[nextIndex];
  const required = rules.requiredCheckins(current?.index ?? null);

  // Seit der letzten Prüfung dieser Sparte; ohne Prüfung seit Vertragsbeginn.
  // Ein Check-in am Prüfungstag selbst zählt nicht mehr.
  const since = current?.date ?? null;
  const counted = input.history
    ? input.history.dates.filter((date) =>
        since
          ? date > since
          : input.contractStart === null || date >= input.contractStart
      ).length
    : null;

  return {
    checkinsRequired: required,
    checkinsSinceLastExam: counted,
    currentGraduation: current?.label ?? "Nicht vorhanden",
    examOrder: nextIndex,
    firstName: input.firstName,
    lastCheckinDate: input.history?.last ?? null,
    lastExamDate: since,
    lastName: input.lastName,
    location: input.location,
    missingCheckins: counted === null ? null : Math.max(required - counted, 0),
    nextExam: nextBelt ? `Prüfung zum ${nextBelt.examLabel}` : rules.transition
  };
}

/**
 * Höchste nicht stornierte Graduierung der Sparte -- nach Rang, nicht nach
 * Datum: MATOOL kennt mehrere Prüfungen am selben Tag.
 */
function currentBelt(
  rules: ProgramRules,
  graduations: readonly GraduationRecord[]
): { date: string; index: number; label: string } | null {
  let best: { date: string; index: number; label: string } | null = null;
  for (const graduation of graduations) {
    const index = beltIndex(rules, graduation);
    if (index < 0) {
      continue;
    }
    if (
      !best ||
      index > best.index ||
      (index === best.index && graduation.date > best.date)
    ) {
      best = { date: graduation.date, index, label: graduation.graduation };
    }
  }
  return best;
}

function beltIndex(rules: ProgramRules, graduation: GraduationRecord): number {
  const byId = rules.belts.findIndex((belt) => belt.id === graduation.graduationId);
  if (byId >= 0) {
    return byId;
  }
  // Rückfall für eine neu angelegte Kennung mit unverändertem Wortlaut.
  const name = normalize(graduation.graduation);
  return rules.belts.findIndex((belt) => normalize(belt.label) === name);
}

async function readStoredPayloads(env: Env): Promise<StoredPayload[]> {
  const rows = await env.DB.prepare(
    `SELECT area, source_id, payload_json
     FROM matool_snapshots
     WHERE area IN ('schueler', 'schueler_details', 'graduierungen', 'checkin_historie')`
  ).all<StoredSnapshotRow>();
  const cipher = await storedPayloadCipher(env);
  return Promise.all(
    rows.results.map(async (row) => ({
      area: row.area,
      payload: parsePayload(
        await cipher.open(
          { area: row.area, sourceId: row.source_id },
          row.payload_json
        )
      ),
      sourceId: row.source_id
    }))
  );
}

function payloadMap(
  stored: readonly StoredPayload[],
  area: string
): Map<string, Record<string, unknown>> {
  return new Map(
    stored
      .filter((entry) => entry.area === area)
      .map((entry) => [entry.sourceId, entry.payload])
  );
}

function graduationMap(
  stored: readonly StoredPayload[]
): Map<string, GraduationRecord[]> {
  const result = new Map<string, GraduationRecord[]>();
  for (const entry of stored.filter(
    (candidate) => candidate.area === "graduierungen"
  )) {
    if (entry.payload.storniert === true) {
      continue;
    }
    const memberId = text(entry.payload.mitglied_id);
    const date = text(entry.payload.pruefungsdatum);
    const graduation = text(entry.payload.graduierung);
    if (!memberId || !date || !graduation) {
      continue;
    }
    const member = result.get(memberId) ?? [];
    member.push({
      date,
      graduation,
      graduationId: text(entry.payload.graduierung_id) ?? ""
    });
    result.set(memberId, member);
  }
  return result;
}

function checkinHistoryMap(
  stored: readonly StoredPayload[]
): Map<string, CheckinHistory> {
  const result = new Map<string, CheckinHistory>();
  for (const entry of stored.filter(
    (candidate) => candidate.area === "checkin_historie"
  )) {
    const dates = collectText(entry.payload.checkin_daten).filter((value) =>
      /^\d{4}-\d{2}-\d{2}$/u.test(value)
    );
    dates.sort((left, right) => right.localeCompare(left));
    result.set(entry.sourceId, { dates, last: dates[0] ?? null });
  }
  return result;
}

function memberLocation(detail: Record<string, unknown>): ExamLocation | null {
  const values = [
    ...collectText(detail.schule),
    ...collectText(detail.klassenliste),
    ...collectText(detail.spartenliste)
  ];
  const namedMatches = EXAM_LOCATIONS.filter((location) => {
    const key = normalize(location);
    return values.some((value) => normalize(value).includes(key));
  });
  const codedMatches = Object.entries(DEFAULT_SCHULEN)
    .filter(([code]) => values.some((value) => normalize(value) === normalize(code)))
    .map(([, location]) => location)
    .filter((location): location is ExamLocation =>
      (EXAM_LOCATIONS as readonly string[]).includes(location)
    );
  const matches = [...new Set([...namedMatches, ...codedMatches])];
  return matches.length === 1 ? matches[0] ?? null : null;
}

/** "01.11.2017" -> "2017-11-01" */
function isoFromGerman(value: unknown): string | null {
  const match =
    typeof value === "string"
      ? /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value.trim())
      : null;
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return collectText(JSON.parse(trimmed) as unknown, depth + 1);
      } catch {
        return [trimmed];
      }
    }
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectText(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectText(entry, depth + 1));
  }
  return [];
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed protected snapshot must never produce a partial workbook.
  }
  throw new AppError(
    "exam_list_snapshot_invalid",
    503,
    "Gespeicherte MATOOL-Daten können für die Prüfungsliste nicht sicher gelesen werden."
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function incompleteMemberData(): AppError {
  return new AppError(
    "exam_list_member_data_incomplete",
    409,
    "Mindestens ein relevantes Kind besitzt keinen vollständigen Vor- und Nachnamen. Die Liste wird vorsorglich nicht erstellt."
  );
}
