/**
 * Fachliche Abschnitte der Detailansicht. Statt einer langen, flachen
 * Feldliste stehen zusammengehoerige Angaben beieinander.
 */
interface FieldGroup {
  keys: readonly string[];
  title: string;
}

const INTERESSENT_GROUPS: readonly FieldGroup[] = [
  { title: "Person", keys: ["id", "nr", "anrede", "vorname", "name", "datum", "status"] },
  {
    title: "Kontakt",
    keys: ["email", "handy", "telefon", "strasse", "plz", "ort", "kontakt", "kontaktart"]
  },
  {
    title: "1. Probetraining",
    keys: [
      "einfuehrung",
      "einfuehrung_zeit",
      "einfuehrung_klasse_name",
      "einfuehrung_klasse",
      "einfuehrung_anwesend",
      "ergebnis_einfuehrung",
      "einfuehrung_ergebnis_default",
      "einfuehrung_benutzer"
    ]
  },
  {
    title: "2. Probetraining",
    keys: [
      "probetraining",
      "probetraining_zeit",
      "probetraining_klasse_name",
      "probetraining_klasse",
      "probetraining_anwesend",
      "ergebnis_probetraining",
      "probetraining_ergebnis_default",
      "probetraining_benutzer"
    ]
  },
  {
    title: "Herkunft und Notizen",
    keys: ["quelle", "werbung", "werbung_bezeichnung", "werbung_formular", "leistung", "schule", "text"]
  }
];

const MITGLIED_GROUPS: readonly FieldGroup[] = [
  {
    title: "Person",
    keys: ["id", "nr", "anrede", "vorname", "name", "geburtstag", "geburtsort", "nationalitaet", "beruf"]
  },
  { title: "Kontakt", keys: ["email", "handy", "telefon", "strasse", "plz", "stadt", "ort"] },
  {
    title: "Vertrag",
    keys: [
      "vertrag",
      "vertragdatum",
      "vertragsbeginn",
      "vertragsende",
      "verlaengerung",
      "kuendigungsfrist",
      "kundenart",
      "abschluss"
    ]
  },
  {
    title: "Zahlung",
    keys: [
      "beitrag",
      "zahlungsperiode",
      "anmeldegebuehr",
      "jahresgebuehr",
      "faellig_am",
      "zahlungsart",
      "kontoinhaber",
      "bank",
      "iban",
      "bic",
      "blz",
      "konto",
      "mandatsref"
    ]
  },
  {
    title: "Schule und Training",
    keys: ["schule", "sparten", "kategorien", "lehrer", "kennzeichen", "barcode", "memo"]
  }
];

function groupsFor(area: string): readonly FieldGroup[] {
  if (area === "interessenten" || area === "interessenten_details") {
    return INTERESSENT_GROUPS;
  }
  if (area === "schueler" || area === "schueler_details" || area === "schueler_ex") {
    return MITGLIED_GROUPS;
  }
  return [];
}

/**
 * Teilt Felder in Abschnitte auf; Reihenfolge innerhalb eines Abschnitts
 * folgt der Liste oben. Unbekannte Felder landen unter "Weitere Felder".
 */
export function groupFields<T extends { key: string }>(
  area: string,
  fields: readonly T[]
): Array<{ fields: T[]; title: string }> {
  const groups = groupsFor(area);
  if (groups.length === 0) {
    return [{ fields: [...fields], title: "Gespeicherte Felder" }];
  }
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const used = new Set<string>();
  const result: Array<{ fields: T[]; title: string }> = [];
  for (const group of groups) {
    const entries = group.keys
      .map((key) => byKey.get(key))
      .filter((field): field is T => field !== undefined && !used.has(field.key));
    for (const field of entries) {
      used.add(field.key);
    }
    if (entries.length > 0) {
      result.push({ fields: entries, title: group.title });
    }
  }
  const rest = fields.filter((field) => !used.has(field.key));
  if (rest.length > 0) {
    result.push({ fields: rest, title: "Weitere Felder" });
  }
  return result;
}
