import { AppError } from "../core/app-error";

export const PROTECTED_DASHBOARD_VALUE = "Geschuetzt";

export interface DashboardFieldDefinition {
  key: string;
  label: string;
  masked: boolean;
}

export interface DashboardFieldValue extends DashboardFieldDefinition {
  value: string;
}

const AREA_LABELS: Readonly<Record<string, string>> = {
  archiv: "Archiv",
  artikel: "Artikel",
  berichte: "Berichte",
  checkin: "Check-ins",
  interessenten: "Interessenten",
  karte: "Karte",
  klassen: "Klassen",
  lager: "Lager",
  newsletter: "Newsletter",
  pruefungen: "Pruefungen",
  schueler: "Schueler / Mitglieder",
  telemetrie: "Telemetrie"
};

const CLASS_FIELD_LABELS: Readonly<Record<string, string>> = {
  alter_ende: "Alter bis",
  alter_start: "Alter von",
  benutzer: "Verantwortliche Kennung",
  beschreibung: "Beschreibung",
  bildDa: "Bild vorhanden",
  endzeit_h: "Ende (Stunde)",
  endzeit_m: "Ende (Minute)",
  freiklasse: "Freie Klasse",
  id: "MATOOL-Klassen-ID",
  id_schulintern: "Interne Klassen-ID",
  kapazitaet: "Kapazitaet",
  klassenende: "Klassenende",
  klassenfarbe: "Klassenfarbe",
  klassenstart: "Klassenstart",
  kurzname: "Kurzname",
  online: "Online-Klasse",
  probetraining_kontingent: "Probetraining-Kontingent",
  raum: "Raumkennung",
  schule: "Schulkennung",
  sms30: "SMS-30-Einstellung",
  sparte: "Sparte",
  startzeit_h: "Beginn (Stunde)",
  startzeit_m: "Beginn (Minute)",
  teilnehmerMax: "Maximale Teilnehmer",
  wochentag: "Wochentag"
};

const CLASS_SAFE_FIELDS = new Set([
  "alter_ende",
  "alter_start",
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
  "online",
  "probetraining_kontingent",
  "raum",
  "schule",
  "sms30",
  "sparte",
  "startzeit_h",
  "startzeit_m",
  "teilnehmerMax",
  "wochentag"
]);

const GENERIC_SAFE_FIELDS = new Set(["columnCount", "tableIndex", "status"]);

const PII_FIELD_PATTERN =
  /(?:^|_)(?:anschrift|adresse|alter|beschreibung|birth|date|email|foto|freitext|geburt|iban|kontakt|link|mail|mobil|nachname|name|notiz|ort|phone|plz|smsText|strasse|telefon|vorname)(?:$|_)/iu;

export function areaLabel(area: string): string {
  return AREA_LABELS[area] ?? area;
}

export function parseStoredPayload(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function dashboardColumns(
  area: string,
  payloads: readonly Record<string, unknown>[],
  plaintext = false
): DashboardFieldDefinition[] {
  const keys = new Set<string>();
  for (const payload of payloads) {
    for (const key of Object.keys(payload)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) {
        keys.add(key);
      }
    }
  }

  return [...keys]
    .sort((left, right) => fieldOrder(area, left) - fieldOrder(area, right) || left.localeCompare(right))
    .map((key) => ({
      key,
      label: fieldLabel(area, key),
      masked: plaintext ? false : isSensitiveDashboardField(area, key)
    }));
}

export function dashboardFieldValues(
  area: string,
  payload: Record<string, unknown>,
  plaintext = false
): DashboardFieldValue[] {
  return dashboardColumns(area, [payload], plaintext).map((field) => ({
    ...field,
    value: formatDashboardValue(payload[field.key], field.masked)
  }));
}

export function dashboardValues(
  area: string,
  payload: Record<string, unknown>,
  columns: readonly DashboardFieldDefinition[],
  plaintext = false
): Record<string, string> {
  return Object.fromEntries(
    columns.map((field) => [
      field.key,
      formatDashboardValue(
        payload[field.key],
        plaintext
          ? false
          : field.masked || isSensitiveDashboardField(area, field.key)
      )
    ])
  );
}

export function searchableDashboardFields(area: string): readonly string[] {
  if (area !== "klassen") {
    return [];
  }
  return [...CLASS_SAFE_FIELDS].filter(
    (field) => !isSensitiveDashboardField(area, field)
  );
}

export function requireDashboardSourceId(value: string): string {
  if (
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  ) {
    throw new AppError(
      "invalid_dashboard_source_id",
      400,
      "Die technische Datensatzkennung ist ungueltig."
    );
  }
  return value;
}

export function requireDashboardPublicId(value: string): string {
  if (!/^[0-9a-f]{32}$/u.test(value)) {
    throw new AppError(
      "invalid_dashboard_record_id",
      400,
      "Die Datensatzkennung ist ungueltig."
    );
  }
  return value;
}

function isSensitiveDashboardField(area: string, key: string): boolean {
  if (/^c\d{2}$/u.test(key)) {
    return true;
  }
  if (PII_FIELD_PATTERN.test(key)) {
    return true;
  }
  if (area === "klassen") {
    return !CLASS_SAFE_FIELDS.has(key);
  }
  return !GENERIC_SAFE_FIELDS.has(key);
}

function fieldLabel(area: string, key: string): string {
  if (area === "klassen" && CLASS_FIELD_LABELS[key]) {
    return CLASS_FIELD_LABELS[key];
  }
  const genericCell = /^c(\d{2})$/u.exec(key);
  if (genericCell?.[1]) {
    return `Feld ${Number.parseInt(genericCell[1], 10) + 1}`;
  }
  return (
    {
      columnCount: "Spaltenanzahl",
      tableIndex: "Tabellenindex",
      status: "Status"
    }[key] ?? key.replaceAll("_", " ")
  );
}

function fieldOrder(area: string, key: string): number {
  if (area === "klassen") {
    const keys = Object.keys(CLASS_FIELD_LABELS);
    const index = keys.indexOf(key);
    return index === -1 ? 1_000 : index;
  }
  if (key === "tableIndex") {
    return 900;
  }
  if (key === "columnCount") {
    return 901;
  }
  const genericCell = /^c(\d{2})$/u.exec(key);
  return genericCell?.[1] ? Number.parseInt(genericCell[1], 10) : 800;
}

function formatDashboardValue(value: unknown, masked: boolean): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (masked) {
    return PROTECTED_DASHBOARD_VALUE;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).slice(0, 2_000);
  }
  return PROTECTED_DASHBOARD_VALUE;
}
