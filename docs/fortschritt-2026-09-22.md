# Fortschritt am 22.09.2026

## Erstes Diagnose-Deployment – 18:02 Uhr Europe/Berlin

Ausgerollt auf `matool-middleware-staging`:

- Gültig leere Check-in-Wochen werden als erfolgreicher Null-Treffer-Abruf
  behandelt. Die vorhandene Historie bleibt erhalten; ungültige Ansichten
  werden weiterhin abgewiesen.
- Personenfreie Pagination-Diagnose erfasst jetzt auch die Fehler vor der
  bisherigen Zeilenprüfung, ungültige spätere Links und Parameterzustände.
  Unbekannte Header werden maskiert, Strukturdiagnosen bleiben unter 15.500
  UTF-8-Bytes.
- Versionsinformationen im Dashboard: tatsächliche Worker-Version,
  SHA-256 des Quellstands und ehrliche Kennzeichnung lokaler Änderungen.

Version: `ab1a5b63-eb41-4c15-a375-c228f1438065`.
Quellstand: `683e398601d4f283625865e02a492c25c258a4a5c8cc5d62665c12b4b150e76e`.
Basiscommit: `91bc1751b9f1694ad7b95713cd419b35f4083e23` – ausdrücklich **kein**
sauberer Commit des gesamten Builds. Ausgangsänderungen wurden bewahrt.

Live-API und sichtbarer Browser-Footer bestätigen Version und Quellstand.
Buildartefakte: `.tmp/deployed-diagnostic-20260922/`.
Rückweg: [Sicherung und Rollback](rollback-2026-09-22.md).

## Prüfungen

- Vollständige Worker-Testreihe: 28 Dateien, 338 Tests bestanden.
- Zusätzlich letzter Parserstand: 67 Tests bestanden.
- Zapier-App: 27 Tests bestanden, keine Veröffentlichung oder Aktivierung.
- Build-Identität: drei native Tests bestanden.
- Alle sechs TypeScript-Projekte geprüft; Repository-Sicherheitscheck grün.
- Web-Build und Worker-Deployment-Dry-run erfolgreich.
- Migrationskette repariert: fünf lokale D1-Tests; keine Remote-Migration nötig.
- Vollständiger D1-Export lokal erfolgreich wiederhergestellt; Integrität ok,
  null Fremdschlüsselfehler (siehe Rollback-Dokument).

Der erste unbeschränkte parallele Volltest erreichte lokale Worker-Start-
Zeitlimits. Die vollständige Wiederholung mit begrenzter Parallelität bestand.

## Noch offen

Der echte Ex-Mitglieder-Fehler ist **noch nicht behoben**. Der erste manuelle
Diagnoseabruf um 18:03 Uhr traf auf den laufenden Stundenabruf und wurde mit
`matool_exact_sync_busy` abgewiesen. Die Sperre wurde nicht umgangen; der
laufende Abruf bleibt ungestört. Nach seinem Abschluss folgt ein kontrollierter
Diagnoseabruf mit dem neuen Build.

Anschließend: gezielter Ex-Mitglieder-Fix mit Vollständigkeitsnachweis,
Interessenten-Leseschicht und Datenansicht, technische Datenaufbewahrung,
Betriebsanzeige und elf-von-elf-Abnahme an einem vollständigen Betriebstag.

Keine fachlichen Daten gelöscht, keine Kundenkommunikation ausgelöst,
keine ausgehenden Zapier-/Kontaktaktionen aktiviert. Mehrere mehrstündige
Unterbrechungen durch fehlendes Workspace-Kontingent bedeuteten Stillstand,
nicht laufende Hintergrundarbeit.
