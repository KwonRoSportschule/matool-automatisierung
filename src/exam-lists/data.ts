import { AppError } from "../core/app-error";
import type { MatoolSafeAreaRecord } from "../matool/client";
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
  program: string;
}

export interface ExamListDataset {
  rows: ReadonlyMap<ExamProgram, readonly ExamListRow[]>;
  unresolvedLocations: ReadonlyMap<ExamProgram, number>;
}

const PROGRAM_KEYS: Readonly<Record<ExamProgram, string>> = {
  "panda-kids": "pandakids",
  "tiger-kids": "tigerkids",
  "warrior-tigers": "warriortigers"
};

/**
 * Joins the freshly read MATOOL member list with the already protected Hub
 * snapshots. Nothing is written to D1 or MATOOL. Ambiguous locations fail
 * closed so no child silently lands in the wrong site worksheet.
 */
export async function loadExamListDataset(
  env: Env,
  liveMembers: readonly MatoolSafeAreaRecord[]
): Promise<ExamListDataset> {
  const liveById = uniqueLiveMembers(liveMembers);
  const stored = await readStoredPayloads(env);
  assertRosterParity(liveById, stored);

  const details = payloadMap(stored, "schueler_details");
  const graduations = graduationMap(stored);
  const checkins = checkinMap(stored);
  const rows = new Map<ExamProgram, ExamListRow[]>(
    EXAM_PROGRAMS.map((program) => [program, []])
  );
  const missingLocations: Record<ExamProgram, number> = {
    "panda-kids": 0,
    "tiger-kids": 0,
    "warrior-tigers": 0
  };

  for (const [sourceId, member] of liveById) {
    const detail = details.get(sourceId) ?? {};
    const memberGraduations = graduations.get(sourceId) ?? [];
    const programs = activePrograms(detail, memberGraduations);
    for (const program of programs) {
      const location = memberLocation(detail);
      if (!location) {
        missingLocations[program] += 1;
        continue;
      }
      const history = memberGraduations
        .filter((entry) => matchesProgram(entry.program, program))
        .sort((left, right) => right.date.localeCompare(left.date));
      const latest = history[0];
      const lastExamDate = latest?.date ?? null;
      const memberCheckins = checkins.get(sourceId) ?? [];
      const lastCheckinDate = memberCheckins.length > 0
        ? [...memberCheckins].sort((left, right) => right.localeCompare(left))[0] ?? null
        : null;
      const checkinsSinceLastExam = lastExamDate
        ? memberCheckins.filter((date) => date > lastExamDate).length
        : null;
      const missingCheckins = requiredCheckins(program, latest?.graduation);
      const remainingCheckins =
        missingCheckins !== null && checkinsSinceLastExam !== null
          ? Math.max(missingCheckins - checkinsSinceLastExam, 0)
          : null;
      const firstName = text(member.vorname) ?? text(detail.vname);
      const lastName = text(member.name) ?? text(detail.name);
      if (!firstName || !lastName) {
        throw incompleteMemberData();
      }
      rows.get(program)?.push({
        checkinsSinceLastExam,
        checkinsRequired: missingCheckins,
        currentGraduation: latest?.graduation ?? "Nicht vorhanden",
        firstName,
        lastExamDate,
        lastCheckinDate,
        lastName,
        location,
        // There is no approved per-program/per-rank threshold in the Hub.
        missingCheckins: remainingCheckins,
        nextExam: nextExam(latest?.graduation)
      });
    }
  }

  return {
    rows,
    unresolvedLocations: new Map(
      EXAM_PROGRAMS.map((program) => [program, missingLocations[program]])
    )
  };
}

function requiredCheckins(
  program: ExamProgram,
  graduation: string | undefined
): number | null {
  if (program !== "warrior-tigers" || !graduation) {
    return null;
  }
  const match = /(?:^|\D)(\d{1,2})\.?\s*kup(?:\D|$)/iu.exec(graduation);
  if (!match?.[1]) {
    return null;
  }
  const kup = Number.parseInt(match[1], 10);
  if (kup >= 6 && kup <= 10) return 12;
  if (kup === 5) return 32;
  if (kup >= 1 && kup <= 4) return 36;
  return null;
}

function uniqueLiveMembers(
  records: readonly MatoolSafeAreaRecord[]
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    if (!/^\d{1,32}$/u.test(record.sourceId) || result.has(record.sourceId)) {
      throw new AppError(
        "exam_list_live_roster_invalid",
        502,
        "Der aktuelle MATOOL-Mitgliederbestand enthält keine eindeutigen Kennungen."
      );
    }
    result.set(record.sourceId, { ...record.payload });
  }
  if (result.size === 0) {
    throw new AppError(
      "exam_list_live_roster_empty",
      502,
      "MATOOL hat keinen verwendbaren Mitgliederbestand geliefert."
    );
  }
  return result;
}

async function readStoredPayloads(env: Env): Promise<StoredPayload[]> {
  const rows = await env.DB.prepare(
    `SELECT area, source_id, payload_json
     FROM matool_snapshots
     WHERE area IN ('schueler', 'schueler_details', 'graduierungen', 'checkin')`
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

function assertRosterParity(
  live: ReadonlyMap<string, unknown>,
  stored: readonly StoredPayload[]
): void {
  const storedIds = new Set(
    stored
      .filter((entry) => entry.area === "schueler")
      .map((entry) => entry.sourceId)
  );
  const missing = [...live.keys()].filter((sourceId) => !storedIds.has(sourceId));
  const stale = [...storedIds].filter((sourceId) => !live.has(sourceId));
  if (missing.length > 0 || stale.length > 0) {
    throw new AppError(
      "exam_list_roster_outdated",
      409,
      `Der aktuelle MATOOL-Bestand und der gespeicherte Hub-Bestand unterscheiden sich (${missing.length} fehlen, ${stale.length} veraltet). Bitte zuerst den vollständigen Mitgliederabgleich abschließen.`
    );
  }
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
    const program = text(entry.payload.sparte);
    if (!memberId || !date || !graduation || !program) {
      continue;
    }
    const member = result.get(memberId) ?? [];
    member.push({ date, graduation, program });
    result.set(memberId, member);
  }
  return result;
}

function checkinMap(stored: readonly StoredPayload[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const entry of stored.filter((candidate) => candidate.area === "checkin")) {
    const memberId = text(entry.payload.mitglied_id);
    const date = text(entry.payload.checkin_datum);
    if (!memberId || !date) {
      continue;
    }
    const member = result.get(memberId) ?? [];
    member.push(date);
    result.set(memberId, member);
  }
  return result;
}

function activePrograms(
  detail: Record<string, unknown>,
  graduations: readonly GraduationRecord[]
): ExamProgram[] {
  const activeText = collectText(detail.spartenliste).join(" ");
  const explicit = EXAM_PROGRAMS.filter((program) =>
    matchesProgram(activeText, program)
  );
  if (explicit.length > 0) {
    return explicit;
  }
  const latest = [...graduations].sort((left, right) =>
    right.date.localeCompare(left.date)
  )[0];
  return latest
    ? EXAM_PROGRAMS.filter((program) => matchesProgram(latest.program, program))
    : [];
}

function memberLocation(detail: Record<string, unknown>): ExamLocation | null {
  const values = [
    ...collectText(detail.schule),
    ...collectText(detail.klassenliste),
    ...collectText(detail.spartenliste)
  ];
  const matches = EXAM_LOCATIONS.filter((location) => {
    const key = normalize(location);
    return values.some((value) => normalize(value).includes(key));
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

function matchesProgram(value: string, program: ExamProgram): boolean {
  return normalize(value).includes(PROGRAM_KEYS[program]);
}

function nextExam(graduation: string | undefined): string {
  if (!graduation) {
    return "Nächste Prüfung noch zu klären";
  }
  const match = /(?:^|\D)(\d{1,2})\.?\s*kup(?:\D|$)/iu.exec(graduation);
  if (!match?.[1]) {
    return "Nächste Prüfung noch zu klären";
  }
  const current = Number.parseInt(match[1], 10);
  return current > 1
    ? `Prüfung zum ${current - 1}. Kup`
    : "Nächste Prüfung nach 1. Kup noch zu klären";
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
    .replace(/[\u0300-\u036f]/gu, "")
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
