import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/zapier-trigger-analyse-20260825";
await fs.mkdir(outputDir, { recursive: true });

const C = {
  navy: "#17365D",
  blue: "#D9EAF7",
  lightBlue: "#EAF3F8",
  green: "#E2F0D9",
  amber: "#FFF2CC",
  red: "#FCE4D6",
  gray: "#F2F2F2",
  border: "#C9D3DD",
  text: "#1F2937",
  white: "#FFFFFF"
};

const rows = [
  ["I-01", "Interessenten", "Optimiertes Anschreiben vor dem PT", "Interessenten-Detail neu/geändert; erster PT liegt in der Zukunft", "bei Anlage/Terminänderung; Versand nach freigegebenem Vorlauf", "Interessenten-Details", "id, vorname, email, handy, leistung, sparte/klasse, probetraining, probetraining_zeit, status", "aktiver Termin; passender Kanal/Einwilligung; keine Absage/kein Opt-out; event_id + Termin-ID deduplizieren", "Haben wir schon", "Fehlt noch", "Bestehender generischer Changefeed für Interessenten-Details; fachlicher Kandidatenfilter und produktiver Zap fehlen.", "Kontaktvorlauf, Textbausteine je Sparte, Einwilligungs-/Opt-out-Regel"],
  ["I-02", "Interessenten", "E-Mail-Erinnerung 1 Tag vor PT", "Termin erreicht T−1 Tag", "1 Tag vor erstem Probetraining", "Interessenten-Details", "id, vorname, email, probetraining, probetraining_zeit, status", "nur aktive Termine mit E-Mail; bei Verschiebung neu planen; pro Termin einmal", "Haben wir schon", "Fehlt noch", "Termin- und E-Mail-Felder liegen im Interessenten-Detail vor. GästePass und Dokumente sind ausdrücklich nicht Teil dieses Umfangs.", "Versandzeit und Inhalt"],
  ["I-03", "Interessenten", "Telefonliste 1 Tag vor PT", "Tageskandidaten T−1", "täglich, z. B. morgens", "Interessenten-Details", "id, name, telefon, handy, probetraining, probetraining_zeit, klasse, status", "aktive Termine; nur erreichbare Nummern; Liste nach Zeit/Klasse sortieren; nicht erneut listen", "Haben wir schon", "Fehlt noch", "Die Liste ist eine Zapier-Such-/Digest-Ausgabe, kein eigener MATOOL-Webhook.", "Verantwortliche, Zeitpunkt, Ziel der Telefonliste"],
  ["I-04", "Interessenten", "SMS-/WhatsApp-Erinnerung vor PT", "Termin erreicht T−1 bzw. definierter Vorlauf", "1 Tag vor PT (Zeitfenster definieren)", "Interessenten-Details + Messaging-Anbieter", "id, vorname, handy, probetraining, probetraining_zeit, status, Einwilligung", "valide Mobilnummer und Rechtsgrundlage; Kanalpräferenz; keine Absage/kein Opt-out; providerseitige Deduplizierung", "Haben wir schon", "Fehlt noch", "MATOOL liefert die Mobilnummer; Versandkanal, Consent und Anbieter sind nicht angebunden.", "SMS/WhatsApp-Anbieter, Consent-Feld/Regel, Text und Sendezeiten"],
  ["I-05", "Interessenten", "Telefonliste: nicht erschienen", "PT-Ergebnis/Anwesenheit ändert sich auf „nicht erschienen“", "nach Termin bzw. beim Statuswechsel", "Interessenten-Details", "id, name, telefon, handy, probetraining, probetraining_anwesend, ergebnis_probetraining, status", "nur bestätigtes Nichterscheinen; Ausschlüsse; pro Termin nur einmal", "Haben wir schon", "Fehlt noch", "Die passenden Felder sind vorhanden; die fachlichen Werte für „nicht erschienen“ müssen festgelegt werden.", "exakter MATOOL-Wert für Nichterscheinen und Bearbeitungsfrist"],
  ["I-06", "Interessenten", "Nachbearbeitung bei „Kein Interesse“", "Status ändert sich auf „Kein Interesse“", "nach 2/4/6 Wochen sowie 3/6 Monaten", "Interessenten-Details", "id, name, email, status, status_geändert_am (aus Changefeed), quelle, Sparte", "Statuswert exakt matchen; Opt-out beachten; fünf Zeitpunkte aus einem Start-Event; event_id + Stufe deduplizieren", "Haben wir schon", "Fehlt noch", "Der Änderungszeitpunkt kann in der Middleware geführt werden; die Zeitstrecke wird in Zapier mit Delays/Pfaden modelliert.", "exakter Statuswert, Inhalte, Stop-Regel bei neuem Status/Vertrag"],
  ["I-07", "Interessenten", "Telefonliste alte Interessenten", "Interessent seit 12 Monaten ohne relevante Aktivität", "täglich/monatlich als Stichtagsprüfung", "Interessenten-Details + ggf. Mitgliedsabgleich", "id, name, telefon, email, datum/Erstkontakt, status, letzter Kontakt, Mitglieds-/Vertragsstatus", "nur weiter inaktive Personen; keine Sperre/kein Opt-out; keine inzwischen gewordenen Mitglieder", "Haben wir schon", "Fehlt noch", "Anlage-/Interessentendatum ist vorhanden; „letzter Kontakt“ und Abgleich gegen Mitgliedschaft müssen noch fachlich definiert werden.", "Definition „alt/inaktiv“, Abgleichschlüssel Interessent↔Mitglied, Kontaktfreigabe"],
  ["N-01", "Neumitglieder", "Willkommensnachricht", "Mitglied neu bzw. Vertragsbeginn", "bei neuem Mitglied/Vertragsstart", "Minimierte Mitglieder-Details", "schueler_nr/vertragid, vname, name, email, vertragsbeginn, vertrag", "gültige E-Mail; Vertragsbeginn; keine Doppelmail bei Datenkorrektur; Vertrags-ID deduplizieren", "Haben wir schon", "Fehlt noch", "Der minimierte Mitglieder-Trigger überträgt Kontakt- und Vertragsdaten, aber keine Bank-/Zahlungsdaten. Vertragskopien sind ausdrücklich nicht Teil dieses Umfangs.", "Exaktes Neumitglied-Kriterium und Inhalt"],
  ["N-02", "Neumitglieder", "Onboarding Woche 1", "Start-Event „Mitglied/Vertrag neu“", "7 Tage nach Vertragsbeginn", "Mitglieder-Details + Content/Link", "vertragid, vname, email/handy, vertragsbeginn, klassenliste, spartenliste", "nur aktive Mitgliedschaft; Stop bei Kündigung; Vertrags-ID + Onboarding-Stufe deduplizieren", "Haben wir schon", "Fehlt noch", "Kein neuer MATOOL-Trigger: derselbe Vertragsstart startet eine verzögerte Zapier-Strecke.", "Patenzuordnung, Anfängerfibel-Link, Kanal/Consent"],
  ["N-03", "Neumitglieder", "Onboarding Woche 2", "Start-Event „Mitglied/Vertrag neu“", "14 Tage nach Vertragsbeginn", "Mitglieder-Details + Content/Link", "vertragid, vname, email/handy, vertragsbeginn, klassenliste, spartenliste", "wie N-02; vor Versand Mitgliedschaft erneut prüfen", "Haben wir schon", "Fehlt noch", "Zweite verzögerte Stufe derselben Onboarding-Strecke.", "Inhalt und Kanal"],
  ["N-04", "Neumitglieder", "Telefonliste Zufriedenheit (Woche 3)", "Start-Event „Mitglied/Vertrag neu“", "21 Tage nach Vertragsbeginn", "Mitglieder-Details", "vertragid, name, telefon, handy, vertragsbeginn, klasse/Sparte, Status/Kündigung", "aktive Mitgliedschaft; Telefonfreigabe; Liste statt Nachricht; einmal je Vertrag", "Haben wir schon", "Fehlt noch", "Telefonliste wird aus Zapier erzeugt; Mitglieder-Status/Kündigung muss zuverlässig verfügbar sein.", "Listenempfänger und Status-/Kündigungsfeld"],
  ["N-05", "Neumitglieder", "Onboarding Woche 4: Bewertung", "Start-Event „Mitglied/Vertrag neu“", "28 Tage nach Vertragsbeginn", "Mitglieder-Details + Bewertungslink", "vertragid, vname, email/handy, vertragsbeginn, aktive Mitgliedschaft", "aktive, zufriedene Mitglieder; Ausschlüsse für offene Beschwerden; nur einmal", "Haben wir schon", "Fehlt noch", "Vierte verzögerte Stufe; die Zufriedenheits-/Beschwerdelogik ist noch nicht als Datensatz definiert.", "Google-/Rosenheims-Beste-Link, Zulässigkeits- und Ausschlussregel"],
  ["N-06", "Neumitglieder", "Onboarding Woche 5: Prüfungssystem", "Start-Event „Mitglied/Vertrag neu“", "35 Tage nach Vertragsbeginn", "Mitglieder-Details + Content/Link", "vertragid, vname, email/handy, vertragsbeginn, Sparte/Klasse", "aktive Mitgliedschaft; passende Sparte; einmal je Vertrag", "Haben wir schon", "Fehlt noch", "Fünfte verzögerte Stufe mit vorhandener Mitgliederbasis.", "Inhalt, Prüfungsklassen/Sparte, Prüfungsgebühren-Regel"],
  ["N-07", "Neumitglieder", "Onboarding Woche 6: Bring a Friend", "Start-Event „Mitglied/Vertrag neu“", "42 Tage nach Vertragsbeginn", "Mitglieder-Details + Content/Link", "vertragid, vname, email/handy, vertragsbeginn, Klasse/Sparte", "aktive Mitgliedschaft; einmal je Vertrag; Stop bei Kündigung", "Haben wir schon", "Fehlt noch", "Sechste verzögerte Stufe mit vorhandener Mitgliederbasis.", "Inhalt, Aktion/Link und Kanal"],
  ["N-08", "Neumitglieder", "Telefonliste Upselling nach 6 Monaten", "Vertragsbeginn erreicht T+6 Monate", "6 Monate nach Vertragsbeginn", "Minimierte Mitglieder-Details + Angebotslogik", "vertragid, name, telefon, vertragsbeginn, vertrag, klassenliste, spartenliste", "aktive Mitgliedschaft; Tarif-/Laufzeitlogik; keine bereits passende Option; einmal je Vertragsperiode", "Haben wir schon", "Fehlt noch", "Vertrags- und Klassendaten werden minimiert an Zapier übertragen; Regel für „1/9 Monate bzw. Action“ fehlt. Beitrag/Zahlungsdaten bleiben absichtlich ausgeschlossen.", "Tarif-/Laufzeitfeld bestätigen, Angebotsmatrix, Listenempfänger"],
  ["M-01", "Mitgliederbetreuung", "E-Mail nach 4 Wochen ohne Check-in", "Letzter Check-in liegt 28 Tage zurück", "tägliche Stichtagsprüfung", "Check-in-Changefeed + Mitglieder-Details", "mitglied_id, checkin_zeitpunkt, klasse_id, vname, email, aktiver Vertragsstatus", "nur aktive Mitgliedschaft; Urlaub/Krankheit/Sperre berücksichtigen; erneuter Check-in beendet die Strecke", "Haben wir schon", "Fehlt noch", "Der feste Check-in-Trigger liefert Mitglieds-ID, Klassen-ID und Zeitstempel. Die 28-Tage-Berechnung wird im Zap mit täglichem Zeitplan und eigener Zustands-/Listenregel definiert.", "Ausnahmen, Text und technische Speicherung/Ermittlung des letzten Check-ins in Zapier"],
  ["M-02", "Mitgliederbetreuung", "Telefonliste nach 6 Wochen ohne Check-in", "Letzter Check-in liegt 42 Tage zurück", "tägliche Stichtagsprüfung", "Check-in-Changefeed + Mitglieder-Details", "mitglied_id, checkin_zeitpunkt, klasse_id, name, telefon, aktiver Vertragsstatus", "wie M-01; nur noch nicht bearbeitete Fälle; einmal pro Inaktivitätsphase", "Haben wir schon", "Fehlt noch", "Benötigt dieselbe vorhandene Check-in-Basis wie M-01. Die Telefonliste selbst wird als Zapier-Digest bzw. Lookup erzeugt.", "Listenprozess, Ausnahmen und Duplikatregel"],
  ["M-04", "Mitgliederbetreuung", "E-Mail 6 Wochen vor Ablauf der GLZ", "Vertragsende erreicht T−42 Tage", "täglich; 42 Tage vor Vertragsende", "Minimierte Mitglieder-Details + Verlängerungs-/Formularprozess", "schueler_nr, vertragid, vname, email, vertragsbeginn, vertragsende, vertrag, klassenliste, Verlängerungs-/Aktivstatus", "aktive, berechtigte Vertragsperiode; 41/42/43-Tage-Grenze; keine bereits verlängerte/gekündigte Person; Vertrags-ID deduplizieren", "Haben wir schon", "Fehlt noch", "Mitglieder-Trigger liefert die notwendigen Vertragsdaten minimiert. GLZ-Prozess und produktive Zustellung sind noch nicht aktiv.", "Angebotsmatrix, Verlängert-Erkennung, Ausschlussgruppen, Formular/Token und Nachfassregel"],
  ["M-05", "Mitgliederbetreuung", "Prüfung eingetragen", "Prüfungsdatensatz neu/geändert", "bei bestätigtem Prüfungs-Eintrag", "Prüfungs-/Graduierungs-Changefeed", "graduierung_id, mitglied_id, pruefungsdatum, graduierung, sparte, storniert, pdf_verfuegbar", "nur nicht stornierte Prüfung; Graduierungs-ID deduplizieren", "Haben wir schon", "Fehlt noch", "Der feste Prüfungs-Trigger liest die in MaTool bestätigte Graduierungshistorie. Neu, geändert und storniert sind getrennt erkennbar; der Zap filtert bei Bedarf storniert=false.", "Fachliche Definition „bestätigt“, Inhalt und Empfänger"],
  ["K-01", "Kündigungen / Ex-Mitglieder", "Kündigung abgeschlossen", "Ex-Mitglied neu/geändert", "nach Abschluss der Kündigung; mit Abrufverzögerung", "Ex-Mitglieder-Changefeed", "schueler_nr/source_id, nr, vorname, name, vertrag, first_seen_at", "nur Status „Ex-Mitglied“ nach abgeschlossener Kündigung; pro Mitglied/Austritt einmal", "Haben wir schon", "Fehlt noch", "Neuer eigener Zapier-Trigger liest die in der HAR belegte Ansicht `ex_schueler_auswahl=show`. Er ist das technische Startsignal, nicht der frühere Kündigungseingang.", "Inhalt und ggf. Anreicherung um historische Kontaktdaten"],
  ["K-02", "Kündigungen / Ex-Mitglieder", "Telefonliste 12 Monate nach Austritt", "Ex-Mitglied-Event + Zapier-Delay T+12 Monate", "12 Monate nach erkanntem Ex-Mitglied-Status", "Ex-Mitglieder-Changefeed + historische Mitglieder-Details", "source_id, name, first_seen_at; für Telefonliste zusätzlich telefon/email, Opt-out, Neuvertrag", "nur echte Ex-Mitglieder; kein Neuvertrag; Sperr-/Opt-out- und Rechtsgrundlage prüfen; einmal je Austritt", "Haben wir schon", "Fehlt noch", "Der neue Ex-Mitglied-Trigger liefert das Startsignal. Für die Telefonliste braucht der Zap noch eine festgelegte Anreicherung mit historischen Kontaktdaten und einen Neuvertrags-Ausschluss.", "Kontakt-/Reaktivierungsregel, Anreicherung und Listenempfänger"],
  ["T-01", "Eigene Telemetrie", "Wachstum: Leads, PTs, Verträge", "Täglicher/monatlicher Daten-Snapshot", "täglich oder monatlich; kein Personen-Trigger", "Interessenten-Details + Mitglieder-Details + eigene KPI-Tabelle", "Zeitraum, Interessenten-Erstelldatum, PT-Termin/Ergebnis, Vertragsbeginn, Vertrags-ID, Sparte/Standort", "KPI-Definitionen fixieren; Zeitfenster und Dublettenregeln; nur aggregierte Ausgabe", "Fehlt noch", "Fehlt noch", "Die Rohbasis ist teilweise vorhanden; ein freigegebenes KPI-Modell und die zuverlässige Mitglieder-Synchronisation fehlen.", "Definition Lead/PT/Vertrag, Standorte, Zielwerte und Reporting-Ziel"],
];

const fieldRows = [
  ["Interessenten-Details", "Haben wir schon", "3.492 Interessenten inkl. Details im zuletzt dokumentierten vollständigen Live-Abgleich; Felder für Kontakt, PT, Klasse und Status sind als Allowlist implementiert.", "I-01 bis I-07"],
  ["Mitglieder-Details", "Haben wir schon", "Parser und Feldschema enthalten Vertragsbeginn/-ende, Vertrag, Vertrags-ID, Kontakt- und Tarifangaben. Für Zapier werden diese serverseitig auf Kontakt-, Vertrags-, Klassen- und Statusfelder reduziert; Bank-/Zahlungsdaten bleiben ausgeschlossen.", "N-01 bis N-08, M-04, K-02, T-01"],
  ["Check-ins", "Haben wir schon", "Fester Check-in-Trigger aus der aktuellen Wochenansicht. Übertragen werden ausschließlich Mitglieds-ID, Klassen-ID und lokaler Zeitstempel; 00:00-Platzhalter zählen nicht als Check-in.", "M-01, M-02"],
  ["Prüfungen", "Haben wir schon", "Fester Prüfungs-/Graduierungs-Trigger aus `graduierung_daten.php`: Mitglieds- und Graduierungs-ID, Datum, Grad, Sparte, PDF-Hinweis und Storno-Status.", "M-05"],
  ["Ex-Mitglieder", "Haben wir schon", "Die HAR belegt die gefilterte Ansicht `ex_schueler_auswahl=show`. Der neue feste Trigger meldet nur abgeschlossene Kündigungen als Ex-Mitglied; Zahlungs- und Dokumentdaten bleiben ausgeschlossen.", "K-01, K-02"],
  ["Zapier-App / Changefeed", "Haben wir schon", "Private Zapier-App enthält den generischen REST-Hook sowie feste Trigger für Interessenten, minimierte Mitglieder-Details, Ex-Mitglieder, Check-ins und Prüfungen. Produktionszustellung und aktive v2-Subscription sind noch nicht nachgewiesen.", "technische Basis für alle"],
];

const decisionRows = [
  ["D-01", "Zustellmodell", "MATOOL hat keine API/Webhooks. Änderungen werden per Abruf erkannt: neue Datensätze bis ca. 5 Minuten, reine Feldänderungen spätestens stündlich. Echtzeit im strengen Sinn ist nicht möglich.", "alle", "Kein HAR erforderlich; nur Erwartung an Reaktionszeit bestätigen."],
  ["D-02", "Zapier-Architektur", "Ein Trigger „Neuer/geänderter MATOOL-Datensatz“ je Datenbereich; Zapier-Filter, Paths, Delays und Digest erzeugen die Fachprozesse.", "alle", "Kein HAR erforderlich."],
  ["D-03", "Datenschutz/Einwilligung", "Für E-Mail, SMS, WhatsApp und Reaktivierung gelten Kanal-, Opt-out-, Sperr- und Kontaktzeitregeln. Diese müssen vor Aktivierung verbindlich vorliegen.", "I-01/I-02/I-04/I-06/I-07, N-*, M-01, M-04, K-02", "Fachliche Entscheidung, kein HAR."],
  ["D-04", "Check-in-Ausnahmen", "Urlaub, Krankheit, Sperre und die Regel für den letzten Check-in sind keine MaTool-Feldlücke, sondern eine Fachregel im späteren Zap.", "M-01, M-02", "Ausnahmen und Zustands-/Listenlogik in Zapier festlegen."],
  ["D-05", "Prüfungs-Filter", "Der Trigger liefert auch stornierte Einträge. Ob ausschließlich bestätigte/nicht stornierte Prüfungen weiterlaufen, ist eine fachliche Zapier-Regel.", "M-05", "Filter `storniert = false`, Inhalt und Empfänger festlegen."],
];

const wb = Workbook.create();
const summary = wb.worksheets.add("Übersicht");
const matrix = wb.worksheets.add("Trigger-Matrix");
const fields = wb.worksheets.add("Datenbasis");
const decisions = wb.worksheets.add("Offene Punkte");

for (const sheet of [summary, matrix, fields, decisions]) sheet.showGridLines = false;

function styleTitle(sheet, title, sub, lastCol) {
  sheet.mergeCells(`A1:${lastCol}1`);
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1").format = { fill: C.navy, font: { bold: true, color: C.white, size: 16 }, horizontalAlignment: "left", verticalAlignment: "center" };
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.mergeCells(`A2:${lastCol}2`);
  sheet.getRange("A2").values = [[sub]];
  sheet.getRange("A2").format = { fill: C.lightBlue, font: { color: C.text, italic: true, size: 10 }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange("A2").format.rowHeight = 34;
}

function header(sheet, range) {
  sheet.getRange(range).format = { fill: C.navy, font: { bold: true, color: C.white }, wrapText: true, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "all", style: "thin", color: C.border } };
}

function body(sheet, range) {
  sheet.getRange(range).format = { wrapText: true, verticalAlignment: "top", font: { color: C.text, size: 9 }, borders: { preset: "all", style: "thin", color: C.border } };
}

styleTitle(summary, "Zapier-Trigger: Auswertung der MATOOL-Automatisierungen", "Stand 26.08.2026 · Grundlage: KI-Automatisierungsübersicht, neue HAR und vorhandener Middleware-/Zapier-Code. Zahlungs-, Mahn- und Dokumentthemen sind ausdrücklich nicht im Umfang. „Haben wir schon“ bedeutet: Datenquelle bzw. technische Basis ist im Projekt nachweisbar; „Fehlt noch“: fachliche Regel, Datenbeziehung oder Aktivierung fehlt.", "H");
summary.getRange("A4:H4").values = [["Status", "Anzahl", "Bedeutung", "", "", "", "", ""]];
summary.mergeCells("C4:H4");
header(summary, "A4:H4");
summary.getRange("A5:C7").values = [
  ["Haben wir schon", null, "Datenquelle oder technisches Changefeed-Grundgerüst ist nachweisbar vorhanden. Nicht gleichbedeutend mit einem aktiven Produktions-Zap."],
  ["Fehlt noch", null, "Benötigte Regel, Zuordnung, fachliche Entscheidung, Dokumentquelle oder Aktivierung ist noch offen."],
  ["Nicht möglich", null, "Nicht verwendet: Alle Fachprozesse sind per Abruf umsetzbar. Nur Echtzeit-Webhooks aus MATOOL selbst sind nicht möglich."]
];
summary.getRange("B5").formulas = [[`=COUNTIF('Trigger-Matrix'!$I$5:$I$${4 + rows.length},A5)`]];
summary.getRange("B5:B7").fillDown();
body(summary, "A5:C7");
summary.getRange("A5:A5").format.fill = C.green;
summary.getRange("A6:A6").format.fill = C.amber;
summary.getRange("A7:A7").format.fill = C.red;

summary.getRange("A9:H9").values = [["Kernaussage", "", "", "", "", "", "", ""]];
summary.mergeCells("A9:H9");
header(summary, "A9:H9");
summary.mergeCells("A10:H12");
summary.getRange("A10").values = [["Zapier benötigt nicht 23 voneinander getrennte technische Trigger. Der zentrale Auslöser ist je MATOOL-Datenbereich „Neuer oder geänderter Datensatz“, ergänzt um feste Trigger für Check-ins und Prüfungen. Fachliche Ereignisse wie „1 Tag vor PT“, „Woche 4“ oder „42 Tage vor Vertragsende“ entstehen aus Filter + Zeitberechnung + Delay/Path in Zapier. Für Telefonlisten wird zusätzlich ein täglicher Digest/Lookup-Zap verwendet."]];
summary.getRange("A10:H12").format = { fill: C.lightBlue, wrapText: true, verticalAlignment: "center", font: { color: C.text, size: 11 }, borders: { preset: "outside", style: "thin", color: C.border } };

summary.getRange("A14:H14").values = [["Empfohlene Reihenfolge", "", "", "", "", "", "", ""]];
summary.mergeCells("A14:H14");
header(summary, "A14:H14");
summary.getRange("A15:H18").values = [
  ["1", "Interessenten-Strecke", "I-01 bis I-07 mit vorhandenen Interessenten-Details umsetzen; fachliche Kontaktregeln festlegen.", "", "", "", "", ""],
  ["2", "Mitglieder-/Onboarding-Strecke", "Vollständigen Mitglieder-Abgleich/Changefeed produktionsreif nachweisen; Ex-Mitglied-Trigger ist technisch ergänzt.", "", "", "", "", ""],
  ["3", "Zapier-Fachregeln", "Für Check-in-Ausnahmen, Prüfungsfilter, Kontaktfreigaben und Inhalte die Regeln je Zap festlegen. Zahlungs- und Dokumentthemen sind nicht im Umfang.", "", "", "", "", ""],
  ["4", "Zapier aktivieren", "Staging-Subscription, synthetische Tests, danach freigegebene Zaps und Zielanbieter aktivieren.", "", "", "", "", ""]
];
summary.mergeCells("C15:H15"); summary.mergeCells("C16:H16"); summary.mergeCells("C17:H17"); summary.mergeCells("C18:H18");
body(summary, "A15:H18");
summary.getRange("A15:A18").format = { fill: C.blue, font: { bold: true, color: C.navy }, horizontalAlignment: "center", borders: { preset: "all", style: "thin", color: C.border } };
summary.getRange("A4:H18").format.autofitRows();
summary.getRange("A1:A18").format.columnWidth = 16;
summary.getRange("B1:B18").format.columnWidth = 21;
summary.getRange("C1:C18").format.columnWidth = 28;
for (const col of ["D","E","F","G","H"]) summary.getRange(`${col}1:${col}18`).format.columnWidth = 16;

styleTitle(matrix, "Trigger-Matrix", "Je Zeile ein fachlicher Auslöser. Status bezieht sich auf Datenbasis (Spalte I); die konkrete Zapier-Regel/Produktion steht in Spalte J.", "L");
const matrixHeaders = ["ID", "Bereich", "Automatisierung", "Benötigter Zapier-Auslöser", "Zeitpunkt / Takt", "Benötigter Datensatz", "Pflichtfelder", "Filter, Ausschlüsse & Deduplizierung", "Datenbasis", "Zapier-Regel", "Nachweis / Ist-Stand", "Noch festzulegen bzw. HAR"];
matrix.getRange("A4:L4").values = [matrixHeaders];
header(matrix, "A4:L4");
matrix.getRange(`A5:L${4 + rows.length}`).values = rows;
body(matrix, `A5:L${4 + rows.length}`);
matrix.getRange(`I5:I${4 + rows.length}`).conditionalFormats.add("containsText", { text: "Haben wir schon", format: { fill: C.green, font: { bold: true, color: C.text } } });
matrix.getRange(`I5:J${4 + rows.length}`).conditionalFormats.add("containsText", { text: "Fehlt noch", format: { fill: C.amber, font: { bold: true, color: C.text } } });
matrix.getRange(`I5:J${4 + rows.length}`).conditionalFormats.add("containsText", { text: "Nicht möglich", format: { fill: C.red, font: { bold: true, color: C.text } } });
matrix.freezePanes.freezeRows(4);
matrix.getRange(`A4:L${4 + rows.length}`).format.autofitRows();
const widths = [9, 18, 29, 34, 21, 26, 42, 45, 16, 16, 44, 38];
for (let i = 0; i < widths.length; i++) matrix.getRangeByIndexes(0, i, rows.length + 4, 1).format.columnWidth = widths[i];
matrix.tables.add(`A4:L${4 + rows.length}`, true, "TriggerMatrixTable");

styleTitle(fields, "Datenbasis und technische Bausteine", "Diese Tabelle zeigt, welche Datensätze bereits nachweisbar verfügbar sind und welche Lücken für die Trigger geschlossen werden müssen.", "D");
fields.getRange("A4:D4").values = [["Datenbereich / Baustein", "Status", "Nachweis / Einschränkung", "Relevant für"]];
header(fields, "A4:D4");
fields.getRange(`A5:D${4 + fieldRows.length}`).values = fieldRows;
body(fields, `A5:D${4 + fieldRows.length}`);
fields.getRange(`B5:B${4 + fieldRows.length}`).conditionalFormats.add("containsText", { text: "Haben wir schon", format: { fill: C.green, font: { bold: true, color: C.text } } });
fields.getRange(`B5:B${4 + fieldRows.length}`).conditionalFormats.add("containsText", { text: "Fehlt noch", format: { fill: C.amber, font: { bold: true, color: C.text } } });
fields.freezePanes.freezeRows(4);
fields.getRange(`A4:D${4 + fieldRows.length}`).format.autofitRows();
for (const [col, width] of [["A", 27], ["B", 17], ["C", 84], ["D", 36]]) fields.getRange(`${col}1:${col}${4 + fieldRows.length}`).format.columnWidth = width;
fields.tables.add(`A4:D${4 + fieldRows.length}`, true, "DataBasisTable");

styleTitle(decisions, "Offene Punkte und Entscheidungen", "Für Check-ins und Prüfungen ist keine weitere HAR-Aufnahme erforderlich. Offen sind ausschließlich fachliche Regeln und die spätere Zapier-Aktivierung.", "E");
decisions.getRange("A4:E4").values = [["ID", "Thema", "Was fehlt / warum", "Betroffene Trigger", "Nächster Schritt"]];
header(decisions, "A4:E4");
decisions.getRange(`A5:E${4 + decisionRows.length}`).values = decisionRows;
body(decisions, `A5:E${4 + decisionRows.length}`);
decisions.freezePanes.freezeRows(4);
decisions.getRange(`A4:E${4 + decisionRows.length}`).format.autofitRows();
for (const [col, width] of [["A", 10], ["B", 22], ["C", 64], ["D", 31], ["E", 66]]) decisions.getRange(`${col}1:${col}${4 + decisionRows.length}`).format.columnWidth = width;
decisions.tables.add(`A4:E${4 + decisionRows.length}`, true, "OpenPointsTable");

const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(errors.ndjson);
const inspection = await wb.inspect({ kind: "table", range: "Trigger-Matrix!A4:L12", include: "values,formulas", tableMaxRows: 9, tableMaxCols: 12 });
console.log(inspection.ndjson);

for (const [name, range] of [["Übersicht", "A1:H18"], ["Trigger-Matrix", `A1:L${4 + rows.length}`], ["Datenbasis", `A1:D${4 + fieldRows.length}`], ["Offene Punkte", `A1:E${4 + decisionRows.length}`]]) {
  const image = await wb.render({ sheetName: name, range, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${name}.png`, new Uint8Array(await image.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(`${outputDir}/zapier-trigger-matrix.xlsx`);
