# Fortschritt am 23.09.2026

## P1 – Live-Ursache der ehemaligen Mitglieder belegt

Personenfreie D1-Strukturdiagnose vom 23.09.2026, 09:11:00 UTC:

- Erste Seite: 30 gültig erkannte Datensätze, vier erwartete Spalten.
- Pagination: Seite 1 ausgewählt; 66 Links mit Offsets 30 bis 1980.
- Alle Links enthalten genau `show`, `todo` und `offset`, aber keinen
  `ex_schueler_auswahl`-Parameter. Ort, Parameterwerte und Offsets sind gültig.
- Der bisherige Parser verlangt den Ex-Filter auch in jedem Seitenlink und
  weist daher die gesamte Liste zurück (`matool_paginated_list_schema_mismatch`).
- Dies ist kein Fehler der deaktivierten Zapier-/Kontaktfunktionen.

Lokale Korrektur: Nur in Ex-Mitglieder-Seitenlinks ist der Filter optional.
Wenn vorhanden, muss er weiterhin `show` sein. Der Client folgt diesen Links
nicht direkt, sondern baut jeden Seitenabruf mit dem expliziten Ex-Filter.
Unbekannte/doppelte Parameter, andere Filterwerte, fremde Hosts und fehlende
Pflichtparameter bleiben verboten. Die allgemeine Redirectbehandlung bleibt
unverändert; eine zusätzliche Redirect-Filterinvariante ist nicht Teil dieses Fixes.

Leere Ex-Listen bleiben vorsorglich ein Sicherheitsfehler: Eine eindeutig
erkennbare gültige Leeransicht ist nicht belegt, während live 67 Seiten
angeboten werden. Deshalb kein stilles Leeren eines vorhandenen Bestands.
Beide vollständigen Kontrollabrufe über getrennte Sessions, stabile IDs,
Duplikatprüfung, konsistente Seitenmenge, Schrumpfschutz und atomare
Speicherung bleiben unverändert aktiv.

Regression: Die synthetische 67-Seiten-Nachbildung scheitert vor dem Fix mit
dem Live-Fehler. Nach dem Fix sind 90 Parser-/Store-Tests erfolgreich,
einschließlich 1.987 rein synthetischer Personen, aller kanonischen Abrufpfade,
acht ungültiger Linkvarianten und einer unbestätigt leeren Ex-Liste.

## Weitere P1-Befunde (read-only geprüft)

- Vom 14.09. bis 23.09., 10:14 UTC: 80 erfolgreiche Mitgliederdetailabrufe,
  kein fehlgeschlagener. Letzter historischer Detail-Schemafehler am 11.09.;
  als historischer, aktuell nicht reproduzierter Befund eingeordnet.
- Check-in: 16 `invalid_matool_snapshot`-Fehler am 14.09. (9) und 21.09. (7),
  danach am jeweiligen Montag erfolgreiche Abrufe mit echten Wochenbuchungen.
  Dieses Muster passt zur lokal reproduzierten gültigen Leerwoche; damalige
  Antwortinhalte sind nicht gespeichert und rückwirkend nicht bewiesen.
- Der Leerwochenfix ist seit 22.09. 16:02 UTC ausgerollt. Erfolgreiche heutige
  Abrufe sind belegt; eine echte leere Woche nach Rollout bleibt zu beobachten.
- Ex-Mitglieder-Bestand vor dem Fix-Deployment: null Zeilen. Der erste
  erfolgreiche Abruf importiert einen bisher fehlenden Bestand.
- Kurzzeitiger D1-API-Fehler 7403: nach Prüfung der unveränderten korrekten
  Anmeldung funktionierte der zweite lesende Versuch; keine Rechte verändert.

## Stand und offene Abnahme

Vorabnahme um 11:12 UTC: vollständige Worker-Testreihe **29 Dateien / 355
Tests bestanden**. Alle sechs TypeScript-Projekte geprüft; drei native
Buildidentitäts-Tests grün. Repository-Prüfung 3.297 Dateien erfolgreich.
Web-Build und Worker-Dry-run erfolgreich, Remote-Migrationsliste leer.
Quellhash des geprüften Builds:
`36d4a6ae6c63dbe0d2f507a3b18cc66372146244da3a97025eb7bc7b259b34f5`.

Zusätzliche lokale Dashboardkorrekturen: Laufende Abrufe zählen im Diagramm
nicht länger als Fehler; nur `failed`/`partial_failed` tun dies, wie bereits
im KPI. Der nicht freigegebene Klassenabruf erscheint als deaktiviert und
ohne behaupteten letzten Lauf. Vier gezielte Health-Tests bestätigen diese
Fälle sowie die neutrale Behandlung deaktivierter Kontakt-/Zapier-Funktionen
selbst mit historischen Zustellfehlern. Echte Abruffehler bleiben rot.

Der Deployment-Befehl bewahrt jetzt mit `--keep-vars` auch bisher nur remote
gespeicherte Variablen. Lokaler Branch `kwonro/stabilisierung-20260922`
angelegt; kein Push. Arbeitsunterbrechung etwa 10:18 bis 11:05 UTC wegen
fehlendem Workspace-Kontingent; währenddessen kein Fortschritt behauptet.

Um 11:15 UTC wurde der Ex-Fix einschließlich Statuskorrekturen auf Staging
ausgerollt: Version `bcc29938-dc4d-4dc4-85e7-f79c51650ab5`, Basiscommit
`4d33047b704f5a1d7711143099d871bd90f23e15`. Der Quellhash entspricht dem
Dry-run. Die Markierung „dirty“ bleibt ehrlich bestehen, weil unabhängige
Zapier-App-/Analysearbeiten nicht in diesen Commit aufgenommen wurden.
Keine dieser Arbeiten verworfen oder veröffentlicht. Zusätzlich 27/27
Zapier-App-Tests bestanden. Code-Rückweg siehe Rollback-Dokument.

Der letzte alte Stundenabruf endete um 11:13:44 UTC, Sperre regulär frei.
Offen: erfolgreicher vollständiger Ex-Kontrollabruf, Mengen-/ID-Abgleich und
unveränderter Wiederholungslauf. Elf geplante fehlerfreie Läufe eines ganzen
Betriebstags erst nach Abschluss der Umsetzung prüfen.

Keine Datenbereinigung und keine Aktivierung ausgehender Aktionen.
