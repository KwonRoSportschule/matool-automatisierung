import { AppError } from "../core/app-error";
import {
  MatoolShapeMismatchError,
  type MatoolResponseShape
} from "./response-shape";

export interface MatoolCheckinRecord {
  payload: Record<string, string>;
  sourceId: string;
}

const DAY_NAMES = [
  "montag",
  "dienstag",
  "mittwoch",
  "donnerstag",
  "freitag",
  "samstag",
  "sonntag"
] as const;
const MAX_CHECKINS = 20_000;

/**
 * Liest die Check-in-Eintraege aus der bestaetigten Wochenansicht. MATOOL
 * legt diese nicht als Tabelle ab, sondern als sieben HTML-Strings in einem
 * Inline-Skript. Es werden ausschliesslich die technische Mitglieds- und
 * Klassenkennung sowie der Zeitpunkt uebernommen – keine Namen oder Fotos.
 */
export function parseCheckinPage(body: Uint8Array): MatoolCheckinRecord[] {
  const html = new TextDecoder("utf-8", {
    fatal: false,
    ignoreBOM: false
  }).decode(body);
  if (
    /name\s*=\s*["']mail["']/iu.test(html) &&
    /name\s*=\s*["']pass["']/iu.test(html)
  ) {
    throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
  }

  const lists = new Map<string, string>();
  const pattern =
    /\bnamenliste_(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*=\s*"((?:\\.|[^"\\])*)"\s*;/gu;
  for (const match of html.matchAll(pattern)) {
    const day = match[1];
    const value = match[2];
    if (!day || value === undefined || lists.has(day)) {
      throw checkinSchemaError({
        assignmentCount: lists.size,
        recordCount: 0
      });
    }
    lists.set(day, decodeLegacyJavascriptString(value));
  }

  if (lists.size !== DAY_NAMES.length) {
    throw checkinSchemaError({ assignmentCount: lists.size, recordCount: 0 });
  }
  if (DAY_NAMES.some((day) => !lists.has(day))) {
    throw checkinSchemaError({ assignmentCount: lists.size, recordCount: 0 });
  }

  const records: MatoolCheckinRecord[] = [];
  const sourceIds = new Set<string>();
  for (const day of DAY_NAMES) {
    const list = lists.get(day);
    if (list === undefined) {
      throw checkinSchemaError({
        assignmentCount: lists.size,
        recordCount: records.length
      });
    }
    const entryPattern =
      /\bid\s*=\s*(["'])(\d{1,32})-(\d{14})-(\d{1,32})\1/giu;
    for (const match of list.matchAll(entryPattern)) {
      const memberId = match[2];
      const packedTimestamp = match[3];
      const classId = match[4];
      if (!memberId || !packedTimestamp || !classId) {
        throw checkinSchemaError({
          assignmentCount: lists.size,
          recordCount: records.length
        });
      }
      const timestamp = unpackMatoolTimestamp(packedTimestamp);
      // 00:00:00 steht in der MaTool-Wochenansicht fuer nicht eingecheckte
      // Personen. Diese Eintraege sind kein ausloesendes Check-in-Ereignis.
      if (timestamp.time === "00:00:00") {
        continue;
      }
      const sourceId = `c_${memberId}_${packedTimestamp}_${classId}`;
      if (sourceIds.has(sourceId) || records.length >= MAX_CHECKINS) {
        throw checkinSchemaError({
          assignmentCount: lists.size,
          recordCount: records.length
        });
      }
      sourceIds.add(sourceId);
      records.push({
        payload: {
          checkin_datum: timestamp.date,
          checkin_uhrzeit: timestamp.time,
          checkin_zeitpunkt: `${timestamp.date}T${timestamp.time}`,
          klasse_id: classId,
          mitglied_id: memberId
        },
        sourceId
      });
    }
  }
  return records.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function decodeLegacyJavascriptString(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escape = value[index + 1];
    if (escape === undefined) {
      throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
    }
    index += 1;
    const simpleEscapes: Readonly<Record<string, string>> = {
      '"': '"',
      "'": "'",
      "\\": "\\",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v"
    };
    const simple = simpleEscapes[escape];
    if (simple !== undefined) {
      decoded += simple;
      continue;
    }
    if (escape === "x") {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/iu.test(hex)) {
        throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
      }
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    if (escape === "u") {
      const hex = value.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/iu.test(hex)) {
        throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
      }
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }
    // JavaScript behandelt unbekannte Escape-Zeichen als das Zeichen selbst.
    decoded += escape;
  }
  return decoded;
}

function unpackMatoolTimestamp(value: string): { date: string; time: string } {
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(value);
  if (!match) {
    throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
  }
  const [, year, month, day, hour, minute, second] = match;
  const numeric = [year, month, day, hour, minute, second].map(Number);
  const [numericYear, numericMonth, numericDay, numericHour, numericMinute, numericSecond] = numeric;
  const valid =
    numericYear !== undefined &&
    numericMonth !== undefined &&
    numericDay !== undefined &&
    numericHour !== undefined &&
    numericMinute !== undefined &&
    numericSecond !== undefined &&
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    numericDay >= 1 &&
    numericDay <= 31 &&
    numericHour <= 23 &&
    numericMinute <= 59 &&
    numericSecond <= 59;
  if (!valid) {
    throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
  }
  const candidate = new Date(
    Date.UTC(
      numericYear,
      numericMonth - 1,
      numericDay,
      numericHour,
      numericMinute,
      numericSecond
    )
  );
  if (
    candidate.getUTCFullYear() !== numericYear ||
    candidate.getUTCMonth() !== numericMonth - 1 ||
    candidate.getUTCDate() !== numericDay
  ) {
    throw checkinSchemaError({ assignmentCount: 0, recordCount: 0 });
  }
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`
  };
}

function checkinSchemaError(input: {
  assignmentCount: number;
  recordCount: number;
}): MatoolShapeMismatchError {
  const shape: MatoolResponseShape = {
    area: "checkin",
    rowCount: input.recordCount,
    rowShapes: [
      {
        hasStableId: false,
        header: false,
        nestedRowCount: 0,
        nonEmptyCellCount: 0,
        occurrences: input.assignmentCount,
        schuelerActionCandidateCount: 0,
        tdCount: 0,
        thCount: 0,
        topLevel: true
      }
    ]
  };
  return new MatoolShapeMismatchError(
    new AppError(
      "matool_checkin_schema_mismatch",
      502,
      "Die MATOOL-Check-in-Ansicht entspricht nicht dem bestätigten Schema."
    ),
    shape
  );
}
