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
  interessenten_details: "Interessenten-Details",
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

const INTERESSENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  id: "MATOOL-Interessenten-ID",
  datum: "Datum",
  anrede: "Anrede",
  vorname: "Vorname",
  name: "Nachname",
  strasse: "Strasse",
  plz: "PLZ",
  ort: "Ort",
  telefon: "Telefon",
  handy: "Handy",
  email: "E-Mail",
  quelle: "Quelle",
  kontakt: "Kontakt",
  kontaktart: "Kontaktart",
  schule: "Schule",
  leistung: "Leistung",
  einfuehrung: "Probetraining 1 - Datum",
  einfuehrung_zeit: "Probetraining 1 - Uhrzeit",
  einfuehrung_klasse: "Probetraining 1 - Klasse",
  einfuehrung_klasse_name: "Probetraining 1 - Klassenname",
  einfuehrung_benutzer: "Probetraining 1 - Mitarbeiterkennung",
  einfuehrung_anwesend: "Probetraining 1 - Anwesenheit",
  ergebnis_einfuehrung: "Probetraining 1 - Ergebnis",
  einfuehrung_ergebnis_default: "Probetraining 1 - Ergebnis (Rohwert)",
  probetraining: "Probetraining 2 - Datum",
  probetraining_zeit: "Probetraining 2 - Uhrzeit",
  probetraining_klasse: "Probetraining 2 - Klasse",
  probetraining_klasse_name: "Probetraining 2 - Klassenname",
  probetraining_benutzer: "Probetraining 2 - Mitarbeiterkennung",
  probetraining_anwesend: "Probetraining 2 - Anwesenheit",
  ergebnis_probetraining: "Probetraining 2 - Ergebnis",
  probetraining_ergebnis_default: "Probetraining 2 - Ergebnis (Rohwert)",
  status: "Status",
  text: "Anmerkung",
  werbung: "Werbequelle",
  werbung_bezeichnung: "Werbequelle - Bezeichnung",
  werbung_formular: "Werbequelle - Formularwert"
};

/**
 * Bezeichnungen der Mitglieder-Stammdaten. Die Reihenfolge entspricht dem
 * MATOOL-Formular: Person, Kontakt, Vertrag, Zahlung, Schule.
 */
const SCHUELER_FIELD_LABELS: Readonly<Record<string, string>> = {
  id: "MATOOL-Mitglieds-ID",
  nr: "Nr.",
  anrede: "Anrede",
  vorname: "Vorname",
  name: "Nachname",
  strasse: "Strasse",
  plz: "PLZ",
  stadt: "Stadt",
  ort: "Ort",
  telefon: "Telefon",
  handy: "Handy",
  email: "E-Mail",
  beruf: "Beruf",
  geburtstag: "Geburtstag",
  geburtsort: "Geburtsort",
  nationalitaet: "Nationalitaet",
  anmeldegebuehr: "Anmeldegebuehr",
  kundenart: "Kundenart",
  vertragdatum: "Vertragsdatum",
  vertrag: "Vertrag",
  vertragsbeginn: "Vertragsbeginn",
  vertragsende: "Vertragsende",
  verlaengerung: "Verlaengerung",
  kuendigungsfrist: "Kuendigungsfrist",
  zahlungsperiode: "Zahlungsperiode",
  beitrag: "Beitrag",
  jahresgebuehr: "Jahresgebuehr",
  faellig_am: "Faellig am",
  abschluss: "Abschluss",
  zahlungsart: "Zahlungsart",
  bank: "Bank",
  blz: "BLZ",
  konto: "Konto",
  iban: "IBAN",
  bic: "BIC",
  mandatsref: "Mandatsreferenz",
  kontoinhaber: "Kontoinhaber",
  schule: "Schule",
  kennzeichen: "Kennzeichen",
  lehrer: "Lehrer",
  barcode: "Barcode",
  sparten: "Sparten",
  kategorien: "Kategorien",
  memo: "Memo"
};

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

/**
 * Felder, ueber die die Suche laeuft.
 *
 * Die Liste ist bewusst fest verdrahtet: Der Feldname wird in den JSON-Pfad
 * der Abfrage eingesetzt und darf deshalb nicht aus Nutzereingaben oder aus
 * dem Bestand stammen. Sie deckt ab, wonach ein Mensch tatsaechlich sucht --
 * Person, Kontakt, Anschrift, Kennung -- und laesst Bankdaten aus.
 */
const SEARCH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  interessenten: [
    "id",
    "vorname",
    "name",
    "email",
    "telefon",
    "handy",
    "strasse",
    "plz",
    "ort",
    "status",
    "quelle",
    "datum"
  ],
  schueler: [
    "id",
    "nr",
    "vorname",
    "name",
    "email",
    "telefon",
    "handy",
    "strasse",
    "plz",
    "ort",
    "stadt",
    "barcode",
    "kundenart",
    "vertrag"
  ]
};

/**
 * In der maskierten Ansicht bleibt nur suchbar, was auch angezeigt wird.
 * Sonst liesse sich ueber Treffer/kein Treffer ein maskierter Wert erraten.
 * Im freigegebenen Klartextbetrieb entfaellt diese Einschraenkung.
 */
export function searchableDashboardFields(
  area: string,
  plaintext = false
): readonly string[] {
  const fields = area === "klassen" ? [...CLASS_SAFE_FIELDS] : SEARCH_FIELDS[area];
  if (!fields) {
    return [];
  }
  if (plaintext) {
    return [...fields];
  }
  return fields.filter((field) => !isSensitiveDashboardField(area, field));
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
  if (
    (area === "schueler" || area === "schueler_details") &&
    SCHUELER_FIELD_LABELS[key]
  ) {
    return SCHUELER_FIELD_LABELS[key];
  }
  if (
    (area === "interessenten" || area === "interessenten_details") &&
    INTERESSENT_FIELD_LABELS[key]
  ) {
    return INTERESSENT_FIELD_LABELS[key];
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
  if (area === "schueler" || area === "schueler_details") {
    const index = Object.keys(SCHUELER_FIELD_LABELS).indexOf(key);
    if (index !== -1) {
      return index;
    }
  }
  if (area === "interessenten" || area === "interessenten_details") {
    const keys = Object.keys(INTERESSENT_FIELD_LABELS);
    const index = keys.indexOf(key);
    if (index !== -1) {
      return index;
    }
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
