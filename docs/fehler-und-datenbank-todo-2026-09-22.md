# Fehler- und Datenbank-Überarbeitung – Analyse und To-do

Stand: 22.09.2026
Umfang: Umsetzung am 22.09.2026 vom Nutzer freigegeben; laufende Arbeit mit
Zehn-Minuten-Berichten. Abgehakte lokale Änderungen sind nicht automatisch
bereits ausgerollt. Deployment- und Beobachtungsstatus separat nachweisen.

## 1. Belegter Ist-Zustand

### Laufzeitfehler

- Der automatische Abruf läuft an Werktagen elfmal pro Tag im fachlichen Zeitfenster.
- Seit mindestens 15.09.2026 scheitert jeder dieser Läufe im Bereich
  `schueler_ex` (ehemalige Mitglieder / Kündigung abgeschlossen).
- Der konkrete Fehler lautet `matool_paginated_list_schema_mismatch`.
- Dadurch wird jeder ansonsten erfolgreiche Gesamtlauf als `partial_failed`
  gewertet. Das erklärt die 55 fehlgeschlagenen Läufe in fünf vollständigen
  Werktagen.
- Die bewusst deaktivierten Zapier-, Kontakt- und Zustellfunktionen erzeugen
  diesen Fehler nicht. Sie werden lediglich als deaktiviert dargestellt.
- Zusätzlich gab es wiederkehrende, aber aktuell nicht mehr auftretende
  Fehler bei Check-ins (`invalid_matool_snapshot`) und ältere Fehler bei den
  Mitgliederdetails. Sie müssen als eigene Nebenbefunde geprüft werden.

### Diagnose- und Testlücke

- Die vorhandenen Parser- und Dashboardtests bestehen (136/136 in der
  gezielten Testauswahl).
- Der synthetische Test für `schueler_ex` bildet die echte MATOOL-Antwort
  offenbar nicht ausreichend nach.
- Die gespeicherte Antwortform-Diagnose enthält keinen Eintrag für
  `schueler_ex`, weil Fehler in der Pagination vor der bisherigen
  Formaufnahme entstehen können.
- Die unmittelbare Live-Abweichung ist deshalb noch nicht beweissicher auf
  ein einzelnes HTML- oder URL-Merkmal eingegrenzt. Eine Korrektur ohne diesen
  Nachweis wäre Raten.

### Datenbank und Datenansicht

- Staging-D1 ist rund 172 MB groß.
- Es gibt 26 fachliche bzw. technische Tabellen. Mehrere Legacy-Tabellen sind
  leer, stehen aber weiterhin im Schema.
- Aktueller Bestand: 12.559 Snapshot-Zeilen und 84.685 Änderungseinträge.
- Besonders auffällig sind 66.018 historische `updated`-Einträge für
  Interessenten. Der Verlauf ist durch frühere Darstellungsfelder teilweise
  mit Scheinänderungen belastet und deshalb nicht ungeprüft fachlich nutzbar.
- `interessenten_sync_staged_lists` enthält 241.926 Zeilen und
  `interessenten_sync_progress_batches` 14.157 Zeilen. Für diese technischen
  Arbeitsdaten fehlt eine wirksame Aufräum- bzw. Aufbewahrungsstrategie.
- Interessentenliste und Interessentendetails werden technisch getrennt
  gespeichert. Die laufende Detail-Synchronisation verarbeitet Batches; die
  derzeitige Anzeige „aktuell“ ist dadurch missverständlich.
- In der ausgelieferten Datenansicht erscheinen sieben technische Bereiche,
  obwohl die Leseschnittstelle nur zwei zusammengeführte Hauptbereiche
  freigibt. Der Bundle-Abgleich belegt inzwischen: Dies ist eine Inkonsistenz
  der bestehenden UI/API, kein Beweis für verschiedene Codefassungen.
- In der Interessenten-Tabelle werden derzeit nur vier automatisch gewählte
  Datenfelder angezeigt. Rohwerte wie `0`/`1` sind nicht erklärt; wichtige
  Informationen zu Kontakt, Status und Probetraining ergeben keine kompakte
  fachliche Gesamtansicht.

### Versions- und Migrationsrisiko

- Das Arbeitsverzeichnis enthält umfangreiche nicht eingecheckte Änderungen.
- Mindestens zwei lokal nicht versionierte Migrationen sind in Staging bereits
  angewendet.
- Die D1-Historie enthält mehrfach verwendete Nummern (`0007`, `0008`,
  `0010`) und Migrationen, die im aktuellen Migrationsordner nicht vollständig
  wiederzufinden sind.
- Die GitHub-Automation prüft nur; separat konfigurierte Cloudflare Builds
  konnten mangels API-Rechten nicht ausgeschlossen werden. Die gesicherte
  lokale Ausgangsfassung entspricht dem ausführbaren Live-Code vollständig,
  war aber nicht als kompletter Git-Commit verfügbar (siehe Deployment-Audit).

## 2. Priorisierte To-do-Liste

## P0 – Quelle der Wahrheit und Sicherung herstellen

- [x] Aktuell ausgelieferte Worker-Version, Git-Commit und lokale Änderungen
  gegeneinander abgleichen (Deployment-Audit, alle 34 Quellabschnitte identisch).
- [x] Vorhandene lokale Arbeiten mit Dateiinventar und Prüfsummen sichern;
  keine bestehenden Änderungen überschreiben. Fachliche Diffs getrennt prüfen.
- [x] Vollständige Liste der in D1 angewendeten Migrationen mit den Dateien im
  Repository abgleichen und fehlende historische Dateien wiederherstellen:
  13 ausführbare Dateien plus zwei dokumentierte historische Varianten im
  Archiv. Frische lokale D1-Kette mit 5/5 Tests abgenommen; Remote-Pending-Liste
  leer. Belege: [Migrationsaudit](migration-audit-2026-09-22.md).
- [x] Wiederhergestellte Migrationen gemeinsam mit der geprüften
  Anwendungsversion in Git versionieren: lokaler Commit `4d33047` auf
  `kwonro/stabilisierung-20260922`, kein Push.
- [x] Regel für neue Migrationen festhalten: ab `0011` nur noch eindeutige,
  fortlaufende Nummern; bereits angewendete historische Namen bleiben erhalten.
- [x] Vollständigen D1-Export samt lokalem Wiederherstellungstest und
  Rückrollkonzept dokumentieren (`rollback-2026-09-22.md`). Vor späterer
  Bereinigung zusätzlich den dann konkret betroffenen Bestand sichern.
- [x] Build-/Versionskennung im Dashboard anzeigen: seit 18:02 Uhr auf Staging,
  mit tatsächlicher Worker-Version, Quellstand-Hash und Basiscommit; lokale
  Änderungen werden ausdrücklich kenntlich gemacht. Git-Versionierung separat offen.

Abnahme: Repository, Migrationen und Staging-Version sind eindeutig
reproduzierbar; ein Rückweg ist dokumentiert.

## P1 – Fehler der ehemaligen Mitglieder beheben

- [x] Personenfreie Diagnose für alle Pagination-Fehler erweitern: erkannte
  Query-Schlüssel, Offset-Menge, ausgewählte Seite, Zeilenformen und
  Datensatzanzahl protokollieren, aber keine Feldwerte oder Personendaten.
  Implementiert, getestet und auf Staging ausgerollt; echter Abruf noch offen.
- [x] Einen echten `schueler_ex`-Abruf diagnostisch ausführen und die reale
  MATOOL-Form gegen den synthetischen Testfall vergleichen (23.09., 09:11 UTC).
- [x] Klären, ob die Abweichung aus Filterzustand, Pagination-URL,
  Sessionzustand, leeren Seiten oder einer abweichenden Ex-Mitglieder-Zeile
  entsteht: Seitenlinks lassen den Ex-Filter weg, kanonische Abrufe setzen ihn.
- [x] Den Ex-Mitglieder-Collector gezielt korrigieren; nur der Linkfilter
  ist optional. Normaler Mitglieder-Collector unverändert. Seit 23.09.,
  11:15 UTC auf Staging (Version `bcc29938`); Live-Abnahme separat offen.
- [x] Leere Ex-Mitglieder-Bestände bleiben ohne belegte gültige Leeransicht
  Sicherheitsfehler. Regressionstest ergänzt; kein stilles Leeren.
- [ ] Vollständigkeit absichern: stabile MATOOL-ID, alle Seiten, keine
  Duplikate, keine stillen Löschungen, zweiter unveränderter Lauf erzeugt null
  Änderungen.
- [ ] Parität zwischen MATOOL-Quellmenge und D1-Bestand für `schueler_ex`
  nachweisen.
- [ ] Nach Deployment mindestens einen vollständigen Betriebstag beobachten:
  elf von elf geplanten Läufen ohne `schueler_ex`-Fehler.

Abnahme: Der Bereich ist vollständig, wiederholbar und grün; der Gesamtlauf
ist nicht mehr `partial_failed`.

## P1 – Weitere reale Fehler von bewusst deaktivierten Funktionen trennen

- [x] Check-in-Fehler vom 14.09. und 21.09. anhand der gespeicherten Läufe
  analysieren und gegen heutige erfolgreiche Läufe vergleichen. Montagmuster
  passt zum Leerwochenfehler; damalige Antwortinhalte nicht rückwirkend belegt.
- [x] Leere, gültige Check-in-Wochen als Null-Treffer-Erfolg behandeln;
  vorherige Historie erhalten. Lokal reproduziert und mit Regressionstests
  korrigiert; seit 22.09. ausgerollt, echte leere Wochenansicht noch zu bestätigen.
- [x] Ältere Mitgliederdetail-Fehler als historisch und aktuell nicht
  reproduziert klassifizieren: seit 14.09. 80 erfolgreiche Abrufe ohne Fehler.
- [x] Aktive Datenabrufe von Kontaktfunktionen trennen; laufende Abrufe im
  Diagramm nicht als Fehler zählen, Klassenabruf korrekt deaktiviert anzeigen.
  Korrigiert, getestet, seit 23.09. auf Staging; Anzeige in P2/P3 vertiefen.
- [x] Bewusst deaktivierte Zapier-/Kontaktfunktionen neutral anzeigen;
  Health-Regression bestätigt auch mit alten Zustellfehlern keinen roten
  Gesamtstatus. Keine Funktionen aktiviert.
- [ ] Warnungen nach Ursache gruppieren, damit elf gleiche Fehler nicht wie elf
  verschiedene Probleme wirken.

Abnahme: Rot bedeutet einen echten Betriebsfehler; deaktiviert bedeutet eine
bewusste Konfiguration.

## P2 – Fachliches Datenmodell für Interessenten schaffen

- [ ] Eine fachliche Leseschicht definieren: ein Interessent = ein Datensatz,
  zusammengesetzt aus Listen- und Detaildaten über die stabile MATOOL-ID.
- [ ] Für die Ansicht feste Feldgruppen definieren:
  - Identität: Vorname, Nachname, MATOOL-ID;
  - Kontakt: E-Mail, Telefon, Mobil;
  - Probetraining: Datum, Uhrzeit, Klasse/Sparte, Anwesenheit, Ergebnis;
  - Bearbeitung: Status, Quelle, Notiz/Memo, angelegt, zuletzt geändert;
  - Datenqualität: Detail vorhanden, zuletzt vollständig synchronisiert.
- [ ] Feldwerte fachlich formatieren: Anrede statt `0/1`, verständliche
  Statusbezeichnungen, deutsche Datums-/Zeitdarstellung, Ja/Nein statt
  technischer Booleans, leere Werte einheitlich.
- [ ] Prüfen, welche Detailfelder tatsächlich gefüllt sind, und fehlende oder
  widersprüchliche Werte als Datenqualitätsstatus sichtbar machen.
- [ ] Das aktuelle Detail-Batch-Modell von der fachlichen
  Aktualitätskennzeichnung trennen. „Aktuell“ darf nicht nur bedeuten „im
  letzten 100er-Batch enthalten“.
- [ ] Technische Roh-Snapshots weiterhin revisionssicher halten, aber nicht als
  primäre Benutzeransicht verwenden.

Abnahme: Eine Person kann ohne Kenntnis von Tabellen- oder Bereichsnamen als
vollständiger Interessent gelesen werden.

## P2 – Datenbankansicht neu strukturieren

- [ ] Standardansicht „Interessenten“ als fachliche Tabelle bauen, nicht als
  generische JSON-Spaltenauswahl.
- [ ] Standardspalten fest festlegen: Name, Status, Kontaktmöglichkeit,
  Probetraining, Klasse/Sparte, Quelle, letzte fachliche Änderung.
- [ ] Schnellfilter ergänzen: Status, Probetraining-Zeitraum, anwesend/nicht
  erschienen, Kontakt vorhanden/fehlt, Details vollständig/unvollständig.
- [ ] Freitextsuche über zusammengeführte Listen- und Detailfelder beibehalten.
- [ ] Detailansicht in lesbare Abschnitte gliedern und technische Metadaten in
  einen einklappbaren Diagnosebereich verschieben.
- [ ] Eigene Ansichten für Mitglieder, ehemalige Mitglieder, Check-ins und
  Graduierungen nur dort anbieten, wo sie fachlich benötigt werden.
- [ ] Leere oder noch nicht funktionierende Bereiche nicht wie vollständige
  Datenbestände präsentieren.
- [ ] Responsive Darstellung und Tastaturbedienung testen.

Abnahme: Die wichtigsten Interessenteninformationen sind ohne Öffnen der
Rohdetails erkennbar; Details sind fachlich gruppiert und durchsuchbar.

## P2 – Datenbank aufräumen und Wachstum begrenzen

- [ ] Für technische Staging-Listen und Fortschrittsbatches eine
  Aufbewahrungsregel definieren, z. B. aktiver Job plus begrenzte Zahl
  abgeschlossener Jobs.
- [ ] Cleanup im erfolgreichen und fehlgeschlagenen Workflow-Pfad
  idempotent implementieren.
- [ ] Die 241.926 vorhandenen Staging-Zeilen nach Sicherung und verifiziertem
  Rückrollplan bereinigen.
- [ ] Den historisch verunreinigten Änderungsverlauf kennzeichnen. Entscheiden,
  ob Scheinänderungen archiviert, abgeschnitten oder nur aus fachlichen
  Auswertungen ausgeschlossen werden.
- [ ] Leere Legacy-Tabellen erst nach Referenzprüfung und Sicherung per
  Migration entfernen oder klar als Altbestand dokumentieren.
- [ ] Abfragepläne der neuen Leseschicht mit `EXPLAIN QUERY PLAN` prüfen und
  gezielte Indizes für Suche, Join und Sortierung ergänzen.
- [ ] Größen- und Zeilenzahl-Metriken im Dashboard aufnehmen, damit erneutes
  ungebremstes Wachstum früh auffällt.

Abnahme: Technische Arbeitsdaten wachsen begrenzt; fachliche Historie und
Rohbestand sind klar getrennt; die wichtigsten Abfragen verwenden passende
Indizes.

## P3 – Verlässliche Betriebsanzeige und Rollout

- [ ] Kennzahlen fachlich benennen: „Gesamtläufe“, „Bereichsfehler“ und
  „einmalige Ursachen“ nicht vermischen.
- [ ] Laufdetails pro Bereich und Fehlercode zusammenfassen.
- [ ] Paritäts- und Vollständigkeitsstatus für Interessenten, Mitglieder und
  Ex-Mitglieder anzeigen.
- [ ] Vor Deployment vollständige Typechecks, Unit-/Integrationstests und
  einen Remote-Dry-Run ausführen.
- [ ] Erst auf Staging ausrollen, dann einen vollen Betriebstag beobachten.
- [ ] Erst nach grüner Staging-Abnahme über Aktivierung weiterer
  Zapier-Funktionen entscheiden.

Abnahme: Der Dashboardstatus ist fachlich eindeutig, der Build reproduzierbar
und der Betrieb einen vollständigen Tag fehlerfrei beobachtet.

## 3. Empfohlene Ausführungsreihenfolge

1. P0: Versionen, Migrationen und Sicherung ordnen.
2. P1: Diagnose erweitern und `schueler_ex` reparieren.
3. P1: Restfehler klassifizieren und Statuslogik bereinigen.
4. P2: Interessenten-Lesemodell und neue Datenansicht umsetzen.
5. P2: Datenbank kontrolliert bereinigen und Retention einführen.
6. P3: Staging-Rollout, Paritätsprüfung und 11-von-11-Beobachtung.

## 4. Vor Umsetzung zu bestätigende Entscheidungen

- Soll der historisch mit Scheinänderungen belastete Verlauf vollständig
  erhalten, archiviert oder ab einem sauberen Stichtag neu begonnen werden?
- Wie lange sollen technische Lauf- und Fortschrittsdaten sichtbar bleiben
  (Vorschlag: detailliert 30 Tage, danach nur aggregiert)?
- Welche Interessentenfelder müssen in der Tabellenansicht sofort sichtbar
  sein und welche ausschließlich in den Details?
- Soll die Testphase weiterhin Klartext anzeigen oder soll die Ansicht jetzt
  auf Mitarbeiterzugriff plus serverseitige Maskierung umgestellt werden?
