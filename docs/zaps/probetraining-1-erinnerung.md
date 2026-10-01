# Zap: Erinnerung einen Tag vor dem 1. Probetraining

Ziel: Am Vortag des ersten Probetrainings bekommt eine (wählbare)
E-Mail-Adresse **genau eine** gestaltete Mail mit allen Infos zum
Interessenten, damit jemand anrufen kann.

Voraussetzung: Zapier-App **1.3.0** (PR #22) ist freigeschaltet. Erst dann
gibt es die Felder „Probetraining 1“, „Probetraining 1 - Datum“ usw.

## Warum so viele Schritte?

Der Trigger meldet jeden neuen **und jeden geänderten** Interessenten. Ohne
Schutz gäbe es bei jeder Änderung (neue Telefonnummer, Status, Notiz) eine
weitere Mail, und ein verschobener Termin würde die alte Erinnerung trotzdem
verschicken. Storage by Zapier merkt sich deshalb pro Interessent den
aktuellen Termin:

- gleicher Termin wie gemerkt → kein zweiter Lauf,
- Termin verschoben oder gelöscht → wartende alte Läufe brechen vor dem
  Versand ab, nur der neue Termin wird erinnert.

## Schritte

| # | App / Aktion | Einstellung |
|---|---|---|
| 1 | **MATOOL Middleware** – Neuer oder geänderter MATOOL-Interessent | Nur neue Interessenten: **Nein**, Nur Änderungen: **Nein** |
| 2 | **Storage by Zapier** – Get Value | Key: `pt1-` + *MATOOL-Interessenten-ID* · Successful if no search results are found: **True** (neuer Interessent hat noch keinen Wert) · Create … if it doesn't exist: **aus** |
| 3 | **Storage by Zapier** – Set Value | Key: wie Schritt 2 · Value: `PT:` + *Probetraining 1 - Datum* + Leerzeichen + *Probetraining 1 - Uhrzeit* |
| 4 | **Filter** – Only continue if | (a) *Probetraining 1 - Datum* · (Text) Exists · (b) *Probetraining 1 - Datum* · (Text) Does not contain · `0000` · (c) Value aus **Schritt 2** (nicht 3!) · (Text) Does not exactly match · gleicher Text wie Value in Schritt 3 |
| 5 | **Formatter** – Date / Time → Add/Subtract Time (Versandzeitpunkt) | Input: *Probetraining 1 - Datum* + ` 10:00` · Expression: `-1 day` · From Format: Custom `DD.MM.YYYY HH:mm` · To Format: Custom `YYYY-MM-DD HH:mm` · Time Zone: `Europe/Berlin` |
| 6 | **Formatter** – Date / Time → Format (Termin als ISO-Datum) | Input: *Probetraining 1 - Datum* · From Format: Custom `DD.MM.YYYY` · To Format: Custom `YYYY-MM-DD` · Time Zone: `Europe/Berlin` |
| 7 | **Filter** | Output aus Schritt 6 · (Date/time) After · `{{zap_meta_human_now}}` (Termin liegt noch in der Zukunft; verhindert Mails für längst vergangene Probetrainings, wenn sich bei alten Interessenten etwas ändert) |
| 8 | **Delay by Zapier** – Delay Until | Date/Time: Output aus Schritt 5. Liegt der Zeitpunkt schon zurück (Anmeldung kurzfristig), läuft der Zap sofort weiter – genau richtig. |
| 9 | **Storage by Zapier** – Get Value | Key: wie Schritt 2 · Successful if no search results are found: **False** (fehlt der Wert, ist etwas faul → anhalten) |
| 10 | **Filter** | Value aus Schritt 9 · (Text) Exactly matches · gleicher Text wie Value in Schritt 3 (sonst wurde der Termin inzwischen verschoben/gelöscht) |
| 11 | **Formatter** – Utilities → Lookup Table *(optional, für die variable Adresse)* | Lookup Key: *Probetraining 1 - Klassenname* · Tabelle z. B. `Tiger-Kids` → `kinder@…`, `Erwachsene` → `trainer@…` · Fallback: `info@…` |
| 12 | **Gmail** – Send Email | To: Ergebnis aus Schritt 11 (oder feste Adresse) · Subject: `Morgen Probetraining: ` + *Vorname* + ` ` + *Nachname* + ` – bitte anrufen` · Body Type: **HTML** · Body: Inhalt von `probetraining-1-erinnerung.html` |

MATOOL liefert Datum und Uhrzeit deutsch (`25.09.2026`, `17:00 Uhr`), daher
die Formate `DD.MM.YYYY` in Schritt 5 und 6. Die Mail kommt am Vortag um
10:00 Uhr; andere Uhrzeit einfach in Schritt 5 ändern.

Bis Zapier-App 1.3.0 freigeschaltet ist, heißen die Felder noch roh:
*Probetraining 1 - Datum* = „Einfuehrung“, *- Uhrzeit* = „Einfuehrung Zeit“,
*- Klassenname* = „Einfuehrung Klasse Name“, *MATOOL-Interessenten-ID* =
„Matool Id“. Achtung: „Probetraining“ ist dort Probetraining **2**.

## Platzhalter in der HTML-Vorlage

HTML aus `probetraining-1-erinnerung.html` in das Body-Feld kopieren und jeden
Platzhalter durch das Feld aus „Insert Data“ (Schritt 1) ersetzen:

| Platzhalter | Feld |
|---|---|
| `[VORNAME]`, `[NACHNAME]` | Vorname, Nachname |
| `[PROBETRAINING_1]` | **Probetraining 1** (fertiger Text) |
| `[KLASSENNAME_1]` | Probetraining 1 - Klassenname |
| `[HANDY]`, `[TELEFON]`, `[EMAIL]` | Handy, Telefon, E-Mail |
| `[PLZ]`, `[ORT]` | PLZ, Ort |
| `[STATUS]`, `[DATUM]` | Status, Datum |
| `[KONTAKT]`, `[KONTAKTART]`, `[WERBEQUELLE]` | Kontakt, Kontaktart, Werbequelle - Bezeichnung |
| `[ANMERKUNG]` | Anmerkung |
| `[MATOOL_ID]` | MATOOL-Interessenten-ID |

Tipp: Platzhalter, die mehrfach vorkommen (`[VORNAME]`, `[HANDY]`,
`[PROBETRAINING_1]` …), überall ersetzen. Einen Testlauf zuerst an die eigene
Adresse schicken.

## Grenzen

- MATOOL wird werktags stündlich (7–18 Uhr UTC) plus einmal abends gelesen.
  Ein am Wochenende eingetragener Termin für Montag kommt erst Montag früh an;
  die Mail geht dann sofort raus.
- Delay Until wartet höchstens rund einen Monat. Termine, die weiter in der
  Zukunft liegen, bitte nicht über diesen Zap erinnern lassen.
- Die Mail enthält Personendaten: nur an interne Adressen schicken.
