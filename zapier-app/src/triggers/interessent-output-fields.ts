import type { PlainOutputField } from "zapier-platform-core";

/**
 * Lesbare Bezeichnungen der Interessenten-Details für "Insert Data" in
 * Zapier. MATOOL nennt Probetraining 1 intern `einfuehrung` und
 * Probetraining 2 `probetraining`; die Bezeichnungen entsprechen der
 * MATOOL-Maske und dem Dashboard. Die Schlüssel bleiben unverändert, damit
 * bestehende Zaps weiter funktionieren. `probetraining_1` und
 * `probetraining_2` ergänzt die Zapier-App selbst (probetraining-text.ts).
 */
export const INTERESSENT_OUTPUT_FIELDS: PlainOutputField[] = [
  { key: "matool_id", label: "MATOOL-Interessenten-ID" },
  { key: "is_new", label: "Neuer Interessent", type: "boolean" },
  { key: "datum", label: "Datum" },
  { key: "anrede", label: "Anrede" },
  { key: "vorname", label: "Vorname" },
  { key: "name", label: "Nachname" },
  { key: "status", label: "Status" },
  { key: "email", label: "E-Mail" },
  { key: "handy", label: "Handy" },
  { key: "telefon", label: "Telefon" },
  { key: "strasse", label: "Straße" },
  { key: "plz", label: "PLZ" },
  { key: "ort", label: "Ort" },
  { key: "kontakt", label: "Kontakt" },
  { key: "kontaktart", label: "Kontaktart" },
  { key: "probetraining_1", label: "Probetraining 1" },
  { key: "einfuehrung", label: "Probetraining 1 - Datum" },
  { key: "einfuehrung_zeit", label: "Probetraining 1 - Uhrzeit" },
  { key: "einfuehrung_klasse_name", label: "Probetraining 1 - Klassenname" },
  { key: "einfuehrung_klasse", label: "Probetraining 1 - Klasse" },
  { key: "einfuehrung_anwesend", label: "Probetraining 1 - Anwesenheit" },
  { key: "ergebnis_einfuehrung", label: "Probetraining 1 - Ergebnis" },
  {
    key: "einfuehrung_benutzer",
    label: "Probetraining 1 - Mitarbeiterkennung"
  },
  { key: "probetraining_2", label: "Probetraining 2" },
  { key: "probetraining", label: "Probetraining 2 - Datum" },
  { key: "probetraining_zeit", label: "Probetraining 2 - Uhrzeit" },
  {
    key: "probetraining_klasse_name",
    label: "Probetraining 2 - Klassenname"
  },
  { key: "probetraining_klasse", label: "Probetraining 2 - Klasse" },
  { key: "probetraining_anwesend", label: "Probetraining 2 - Anwesenheit" },
  { key: "ergebnis_probetraining", label: "Probetraining 2 - Ergebnis" },
  {
    key: "probetraining_benutzer",
    label: "Probetraining 2 - Mitarbeiterkennung"
  },
  { key: "quelle", label: "Quelle" },
  { key: "werbung", label: "Werbequelle" },
  { key: "werbung_bezeichnung", label: "Werbequelle - Bezeichnung" },
  { key: "leistung", label: "Leistung" },
  { key: "schule", label: "Schule" },
  { key: "text", label: "Anmerkung" }
];
