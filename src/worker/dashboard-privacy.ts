import { AppError } from "../core/app-error";

export const PROTECTED_DASHBOARD_VALUE = "Geschützt";

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
  graduierungen: "Prüfungen / Graduierungen",
  interessenten: "Interessenten",
  interessenten_details: "Interessenten-Details",
  karte: "Karte",
  klassen: "Klassen",
  lager: "Lager",
  newsletter: "Newsletter",
  pruefungen: "Prüfungen",
  schueler: "Mitglieder",
  schueler_details: "Mitglieder-Stammdaten",
  schueler_ex: "Ehemalige Mitglieder",
  schueler_stilllegungen: "Stilllegungen",
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
  kapazitaet: "Kapazität",
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
  nr: "Nr. in der Liste",
  datum: "Datum",
  anrede: "Anrede",
  vorname: "Vorname",
  name: "Nachname",
  strasse: "Straße",
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
  strasse: "Straße",
  plz: "PLZ",
  stadt: "Stadt",
  ort: "Ort",
  telefon: "Telefon",
  handy: "Handy",
  email: "E-Mail",
  beruf: "Beruf",
  geburtstag: "Geburtstag",
  geburtsort: "Geburtsort",
  nationalitaet: "Nationalität",
  anmeldegebuehr: "Anmeldegebühr",
  kundenart: "Kundenart",
  vertragdatum: "Vertragsdatum",
  vertrag: "Vertrag",
  vertragsbeginn: "Vertragsbeginn",
  vertragsende: "Vertragsende",
  verlaengerung: "Verlängerung",
  kuendigungsfrist: "Kündigungsfrist",
  zahlungsperiode: "Zahlungsperiode",
  beitrag: "Beitrag",
  jahresgebuehr: "Jahresgebühr",
  faellig_am: "Fällig am (Tag)",
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

const GENERIC_SAFE_FIELDS = new Set([
  "anzahl",
  "checkin_datum",
  "checkin_uhrzeit",
  "checkin_zeitpunkt",
  "graduierung",
  "graduierung_id",
  "klasse_id",
  "mitglied_id",
  "pdf_verfuegbar",
  "pruefungsdatum",
  "sparte",
  "status",
  "storniert",
  "zeitraeume"
]);

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
    value: formatDashboardValue(payload[field.key], field.masked, field.key)
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
          : field.masked || isSensitiveDashboardField(area, field.key),
        field.key
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
    (area === "schueler" ||
      area === "schueler_details" ||
      area === "schueler_ex") &&
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
      checkin_datum: "Check-in-Datum",
      checkin_uhrzeit: "Check-in-Uhrzeit",
      checkin_zeitpunkt: "Check-in-Zeitpunkt",
      graduierung: "Graduierung",
      graduierung_id: "MATOOL-Graduierungs-ID",
      klasse_id: "MATOOL-Klassen-ID",
      mitglied_id: "MATOOL-Mitglieds-ID",
      pdf_verfuegbar: "Prüfungs-PDF vorhanden",
      pruefungsdatum: "Prüfungsdatum",
      sparte: "Sparte",
      storniert: "Storniert",
      status: "Status",
      anzahl: "Anzahl Stilllegungen",
      zeitraeume: "Stilllegungszeiträume"
    }[key] ?? key.replaceAll("_", " ")
  );
}

function fieldOrder(area: string, key: string): number {
  if (area === "klassen") {
    const keys = Object.keys(CLASS_FIELD_LABELS);
    const index = keys.indexOf(key);
    return index === -1 ? 1_000 : index;
  }
  if (
    area === "schueler" ||
    area === "schueler_details" ||
    area === "schueler_ex"
  ) {
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
  const genericCell = /^c(\d{2})$/u.exec(key);
  return genericCell?.[1] ? Number.parseInt(genericCell[1], 10) : 800;
}

/**
 * Kontonummern braucht im Dashboard niemand vollstaendig; MATOOL bleibt die
 * Quelle. Auch im Klartextbetrieb sind nur die letzten vier Stellen sichtbar.
 */
const LAST_DIGITS_ONLY_FIELDS = new Set(["iban", "konto"]);

/** MATOOL speichert Ja/Nein als 0/1. */
const YES_NO_FIELDS = new Set([
  "bildDa",
  "einfuehrung_anwesend",
  "freiklasse",
  "online",
  "pdf_verfuegbar",
  "probetraining_anwesend",
  "storniert"
]);

/** Betraege in Euro. */
const MONEY_FIELDS = new Set(["anmeldegebuehr", "beitrag", "jahresgebuehr"]);

/** Uhrzeiten als HH:MM:SS; 00:00:00 heisst "keine Uhrzeit". */
const TIME_FIELDS = new Set(["einfuehrung_zeit", "probetraining_zeit"]);

/** Verweise, bei denen 0 "nicht gesetzt" bedeutet. */
const ZERO_MEANS_EMPTY_FIELDS = new Set([
  "einfuehrung_benutzer",
  "einfuehrung_klasse",
  "probetraining_benutzer",
  "probetraining_klasse"
]);

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z?)?$/u;
const euroFormatter = new Intl.NumberFormat("de-DE", {
  currency: "EUR",
  style: "currency"
});

/**
 * Macht einen gespeicherten MATOOL-Wert fuer Menschen lesbar: deutsches
 * Datum statt 2026-02-01 00:00:00, leer statt 0000-00-00, Ja/Nein statt 0/1,
 * Euro-Betraege und Uhrzeiten. Der gespeicherte Rohwert bleibt unveraendert.
 */
export function readableDashboardValue(key: string, text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") {
    return "";
  }
  if (YES_NO_FIELDS.has(key)) {
    if (trimmed === "1" || trimmed.toLowerCase() === "true") {
      return "Ja";
    }
    if (trimmed === "0" || trimmed.toLowerCase() === "false") {
      return "Nein";
    }
  }
  if (ZERO_MEANS_EMPTY_FIELDS.has(key) && trimmed === "0") {
    return "";
  }
  if (TIME_FIELDS.has(key)) {
    const time = /^(\d{2}):(\d{2})(?::\d{2})?$/u.exec(trimmed);
    if (time) {
      return time[1] === "00" && time[2] === "00" ? "" : `${time[1]}:${time[2]} Uhr`;
    }
  }
  if (MONEY_FIELDS.has(key) && /^-?\d+(?:[.,]\d{1,2})?$/u.test(trimmed)) {
    return euroFormatter.format(Number(trimmed.replace(",", ".")));
  }
  const date = ISO_DATE_PATTERN.exec(trimmed);
  if (date) {
    const [, year, month, day, hour, minute] = date;
    if (year === "0000" || month === "00" || day === "00") {
      return "";
    }
    const tag = `${day}.${month}.${year}`;
    return hour && minute && !(hour === "00" && minute === "00")
      ? `${tag}, ${hour}:${minute} Uhr`
      : tag;
  }
  return text;
}

function formatDashboardValue(
  value: unknown,
  masked: boolean,
  key = ""
): string {
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
    const text = String(value);
    if (LAST_DIGITS_ONLY_FIELDS.has(key.toLowerCase())) {
      const compact = text.replace(/\s+/gu, "");
      return compact.length > 4 ? `•••• ${compact.slice(-4)}` : "••••";
    }
    return readableDashboardValue(key, text).slice(0, 2_000);
  }
  return PROTECTED_DASHBOARD_VALUE;
}

export interface DashboardSummaryColumn {
  key: string;
  label: string;
}

/**
 * Feste, fachliche Uebersichtsspalten je Bereich. Frueher zeigte die Tabelle
 * einfach die ersten vier Rohfelder -- bei Interessenten also ID, Datum,
 * Anrede (0/1) und Vorname, aber weder Nachname noch Status, Probetraining
 * oder Kontakt.
 */
const SUMMARY_COLUMNS: Readonly<Record<string, readonly DashboardSummaryColumn[]>> = {
  interessenten: [
    { key: "person", label: "Name" },
    { key: "status", label: "Status" },
    { key: "probetraining", label: "1. Probetraining" },
    { key: "kontakt", label: "Kontakt" },
    { key: "angelegt", label: "Angelegt" },
    { key: "quelle", label: "Quelle" }
  ],
  schueler: [
    { key: "person", label: "Name" },
    { key: "mitgliedsnummer", label: "Mitglieds-Nr." },
    { key: "vertrag", label: "Vertrag" },
    { key: "vertragsbeginn", label: "Vertragsbeginn" },
    { key: "beitrag", label: "Beitrag" },
    { key: "kontakt", label: "Kontakt" }
  ]
};

export function dashboardSummaryColumns(area: string): readonly DashboardSummaryColumn[] {
  return SUMMARY_COLUMNS[area] ?? [];
}

/**
 * Werte der Uebersichtsspalten, zusammengesetzt aus Listen- und
 * Detailfeldern. Jedes Einzelfeld wird wie in der Detailansicht maskiert;
 * ist ein Bestandteil geschuetzt, ist es der ganze Wert.
 */
export function dashboardSummaryValues(
  area: string,
  payload: Record<string, unknown>,
  plaintext = false
): Record<string, string> {
  const columns = SUMMARY_COLUMNS[area];
  if (!columns) {
    return {};
  }
  const field = (key: string): string =>
    formatDashboardValue(
      payload[key],
      plaintext ? false : isSensitiveDashboardField(area, key),
      key
    );
  const join = (parts: readonly string[], separator: string): string => {
    const filled = parts.filter((part) => part !== "");
    return filled.includes(PROTECTED_DASHBOARD_VALUE)
      ? PROTECTED_DASHBOARD_VALUE
      : filled.join(separator);
  };
  // Zeilenumbruch statt Trennpunkt: E-Mail und Telefon stehen untereinander.
  const kontakt = join(
    [field("email"), field("handy") || field("telefon")],
    "\n"
  );
  const person = join([field("vorname"), field("name")], " ");

  if (area === "interessenten") {
    const termin = field("einfuehrung");
    const erschienen = field("einfuehrung_anwesend");
    return {
      angelegt: field("datum"),
      kontakt,
      person,
      probetraining:
        termin === ""
          ? ""
          : join(
              [
                join([termin, field("einfuehrung_zeit")], ", "),
                join(
                  [
                    field("einfuehrung_klasse_name"),
                    erschienen === "Ja" ? "erschienen" : ""
                  ],
                  " · "
                )
              ],
              "\n"
            ),
      quelle: join([field("quelle"), field("werbung_bezeichnung")], " · "),
      status: field("status")
    };
  }
  const beitrag = field("beitrag");
  return {
    beitrag: beitrag === "" ? "" : join([beitrag, field("zahlungsperiode")], " "),
    kontakt,
    mitgliedsnummer: field("nr"),
    person,
    vertrag: field("vertrag"),
    vertragsbeginn: field("vertragsbeginn")
  };
}
