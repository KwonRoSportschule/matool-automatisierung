# Fortschritt und neuer Abgleich – 28.09.2026

Stand: 10:00 UTC / 12:00 Uhr Berlin. Kein Deployment, keine Datenbereinigung
und keine Aktivierung oder Auslösung ausgehender Aktionen durch diese Fortsetzung.

## Wiederaufnahme und vorhandene Änderungen

Wiederholte Unterbrechungen durch fehlendes Workspace-Kontingent am 24./25.09.;
für diese Zeiten wird kein Fortschritt behauptet. Aktueller Basiscommit:
`c6031743cb8da41696d0b95713df9a7048b4e8d7` (Merge des Sicherheitsstands aus main).
Fremde Änderungen an Zugriffsschutz, Env, Tests, Web-Typen und Wrangler bleiben
erhalten. Vier TypeScript-Projektdateien sind gelöscht, obwohl Prüfskripte sie
benötigen. Nicht wiederhergestellt; Rückfrage gestellt. Keine neue vollständige
Typecheck-/Build-Abnahme. esbuild-Paketdateien sind wieder vorhanden; Wrangler
und Vitest starten. Der Abschluss der früher unterbrochenen Installation selbst
wurde nicht nachträglich als erfolgreich bestätigt.

## Lokal verifiziert

- Schutz gegen verlorene Mitgliederkennungen: Kandidaten müssen einem
  übernommenen Datensatz oder dessen verschachtelten Details zugeordnet sein.
  Mehrdeutige gemischte Seiten werden nicht still verkürzt; kennungsfreie
  Layoutzeilen bleiben erlaubt.
- Parser-Testdatei: **93/93 Tests bestanden**, 09:54 UTC; darin 16 Fälle zur
  Kennungszuordnung für Mitglieder und Ex-Mitglieder.
- Warnungsgruppen, Dashboard-Health und Exact-Sync-Schutz: **23/23 Tests in
  drei Dateien bestanden**, 09:56 UTC.
- `git diff --check` ohne Fehler. Keine vollständige Testsuite behauptet.
- Lokale Test-D1 und synthetische Antworten; keine Live-Credentials in Tests.

## Rein lesende Live-Kontrolle

D1 um 09:56:31 UTC: `rows_written=0`, `changed_db=false`. Erster Zugriff mit
API 7403; nach Prüfung der unverändert korrekten OAuth-Anmeldung zweiter Zugriff
erfolgreich. Keine Rechte geändert.

| Tag | Ex-Mitglieder erfolgreich | Ex-Mitglieder fehlgeschlagen |
| --- | ---: | ---: |
| 23.09., ab 11:15 UTC | 7 (einschließlich manuellem Teilabruf) | 0 |
| 24.09. | 9 | 0 |
| 25.09. | 7 | 0 |
| 28.09., bis 09:56 UTC | 0 | 3 |

Alle 23 Erfolge speicherten jeweils 1.951 Datensätze. Aktuell weiterhin
**1.951 Zeilen und 1.951 eindeutige IDs**. Das belegt Bestandserhalt, nicht
unabhängige Vollständigkeit gegenüber MATOOL.

Heute drei Gesamtläufe `partial_failed`. Mitglieder, Mitgliederdetails,
Check-ins und Graduierungen jeweils dreimal erfolgreich; Interessentenliste
zweimal und Interessentendetails 64-mal erfolgreich (separater Batch-Workflow).
Mehrere unvollständige Gesamtläufe vom 23.–25.09. stehen weiter auf `running`.
Nicht rückwirkend umklassifiziert. Keine vollständige 11-von-11-Tagesabnahme.

## Neue Fehlerstelle bei Ex-Mitgliedern

Alle drei heutigen Strukturdiagnosen zeigen `stage=rows`, Offset 420,
ausgewählte Seite 15, vier erwartete Spalten, 30 sichtbare Datenzeilen,
22 Kennungszeilen mit einer und acht Kennungszeilen mit zwei Aktionen.
Alle 66 Paginationlinks sind gültig. Der alte Linkfilterfehler ist nicht
die heutige Fehlerstelle.

Aktuelles Deployment laut Cloudflare: `1704607e-0acf-4e81-b6b8-f528cb9e121b`,
erstellt 25.09., 18:35:01 UTC. Lesender Bundle-Abgleich am 28.09., 09:58:19 UTC
bestätigt dort bereits vergleichbaren Vollständigkeitsschutz
(`acceptedIdentifierRows`) und die Bedingung genau einer gültigen Aktion.
SHA-256 des gelesenen `index.js`:
`92d93d80682581cb2cdb7239ce95dfd595b86e33b0b26fa4a0e68c192d72bc35`.
Diese Version wurde nicht in dieser Fortsetzung ausgerollt.

Noch nicht belegt: gleiche/verschiedene Kennungen oder ungültige Zusatzaktion.
Die bisherige Formdiagnose unterscheidet das nicht. Nächster Schritt:
gezielte personendatenfreie Strukturprüfung der Zusatzaktionen. Schutz nicht
aufweichen und keine vollständige Parität behaupten.

## Schutzgrenzen und nächste Arbeiten

Anderer Commit `69c71fa` aktiviert Staging-Zapier-Zustellung im Repository.
Ein manueller Sync kann danach Zustellungen auslösen; ein deaktivierter
Kontaktprozess verhindert diesen separaten Pfad nicht. Deshalb hier kein
Live-Sync, Probe-Workflow oder Deployment. Tatsächlicher Remote-Wert der
Variablen in dieser Fortsetzung nicht abgefragt. Passwortschutz und
Verschlüsselung nicht umgehen oder zurückrollen.

Historische Datenqualitätsprüfung vom 24.09., 09:31 UTC: 3.526 Interessenten,
genau 3.526 zugeordnete Details, keine fehlenden/verwaisten Details oder
Abweichungen in Vorname/Name/Status/Datum. 2.126 Detailabrufe vor jüngster
Listenaufnahme, 1.400 danach; laufende Batches bedeuten nicht automatisch
Datenfehler. 33 Detaildatensätze mit jüngerer Änderung als Listenzeile.
Diese Zahlen sind historisch, nicht der heutige verschlüsselte Stand. Die
zugehörige SQL-Datei setzt lesbares JSON voraus und ist ohne Anpassung kein
Qualitätsnachweis für verschlüsselte Nutzlasten.

Offen: Zusatzaktionen aufklären, Überlappungs-/Abbruchstatus reparieren,
Interessenten-Lesemodell und Ansicht, gesicherte technische Bereinigung,
sicherer Rollout und vollständige Tagesabnahme. Automatisierung nicht beendet.
