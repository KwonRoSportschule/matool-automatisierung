# Fortschritt – 29.09.2026: Ex-Mitglieder, Stilllegungen, manueller Abruf

Stand: 11:50 Uhr Berlin. **Auf Staging ausgerollt, nicht committet und nicht in
`main`.** Keine Änderung an Rechten, Secrets oder Zapier-Abos. D1 lesend geprüft;
geschrieben hat nur ein einzelner manueller Abruf zur Abnahme (siehe unten).

## Ergebnis im Live-Betrieb

Manueller Abruf als Workflow, 09:36:54–09:42:39 UTC (Instanz
`msync_1790674602829`, über `wrangler workflows trigger` gestartet): **6 von 6
Bereichen erfolgreich**, 2.780 Datensätze, 50 neu, 0 geändert.

| Bereich | Gelesen | Neu | Geändert | Entfernt |
| --- | ---: | ---: | ---: | ---: |
| Mitglieder | 557 | 0 | 0 | 0 |
| Ehemalige Mitglieder | 1.991 | 40 | 0 | 0 |
| Stilllegungen (Paket von 10) | 10 | 10 | – | – |

Ex-Mitglieder jetzt **1.991 Zeilen, 1.991 eindeutige IDs** (vorher 1.951). 67
Seiten à 30 ergeben genau 1.991 (66 × 30 + 11); die 40 fehlten seit dem
Parser-Stand vor dem 25.09., der Zeilen mit zwei Aktionen still übersprang. Die
übrigen 1.951 blieben unverändert. Der Stundenlauf um 10:00 UTC wird zusätzlich
beobachtet (60 statt 10 Stilllegungen).

## Ausrollen

- Live läuft **`origin/main`** (789969f) plus die drei Korrekturen, gebaut in einem
  temporären Worktree. `main` liegt 16 Commits vor dem lokalen Branch
  `kwonro/stabilisierung-20260922`; ein Deploy aus dem lokalen Arbeitsverzeichnis
  hätte Beitragsübersicht, Check-in-Schnittstelle, Stilllegungen und den zweiten
  Cron entfernt. Neue Deployments offenbar automatisch bei jedem Merge nach `main`
  (heute 07:06 und 08:28 UTC); der Mechanismus ist nicht geprüft.
- 09:14 UTC Version `328a9c7f` (Ex-Fix), 09:35 UTC Version
  **`0ddb26fb-c63a-4c5b-b484-d76aa443c4ce`** (alle drei Fixes, neuer Workflow
  `matool-direct-sync-staging`). Jeweils nur bei freier Sperre.
- Rückweg vor allen heutigen Änderungen: `1dd6b387-4b16-4838-8747-7431de35954f`
  (`wrangler rollback 1dd6b387-4b16-4838-8747-7431de35954f --env staging`).
- **Die Korrekturen stehen nicht in `main`.** Der nächste Merge nach `main` deployt
  ohne sie, dann fallen alle drei Fehler zurück.

## 1. Ehemalige Mitglieder (`matool_paginated_list_schema_mismatch`)

- Strukturdiagnose: Seite 15 (Offset 420), 8 von 30 Kennungszeilen mit **zwei**
  `formular_fuellen`-Aktionen. Der Parser verlangte genau eine und verwarf die
  ganze Liste (seit 28.09. jeder Lauf).
- Fix `isSchuelerSafeAreaIdentifierRow` (`src/matool/client.ts`): mehrere Aktionen
  erlaubt, **wenn jede lesbar ist und alle dieselbe Kennung nennen**. Fremde
  Kennung, unlesbare Aktion, doppelte Kennung und verwaiste Kennung bleiben
  Fehler. Diagnose nennt zusätzlich die Art der Aktionen, nie Wortlaut/Kennung.
- Wortlaut der zweiten Aktion weiter unbelegt; die HAR vom 29.09. enthält nur
  Seite 1.

## 2. Stilllegungen (`matool_stilllegung_schema_mismatch`)

- Neu aus `main` (PR #14). Stundenlauf 09:13 UTC scheiterte nach 2,7 Sekunden.
- Diagnose: Antwort ist ein Array mit **einem** Eintrag nur aus `name`,
  `zahlungsperiode`, `status`, `periondenarray` – ohne `satz_id` und Zeitraum. Die
  HAR `stilllegung_daten.php.har` zeigt dagegen ein Mitglied **mit** zwei
  Stilllegungen (alle Felder vorhanden). Der Parser verlangte die Satzfelder auch
  für den Formular-Eintrag eines Mitglieds ohne Stilllegung.
- Fix (`src/matool/stilllegung.ts`): Genau ein Eintrag, der nur diese vier
  schlichten Formularfelder trägt, bedeutet „keine Stilllegung“. Neben echten
  Zeiträumen, doppelt, mit Zeitraum-/Satzfeld oder unbekanntem Feld bleibt er
  ein Fehler.

## 3. Manueller Abruf

- Ursache: Der Knopf lief synchron in der Web-Anfrage (5–7 Minuten). Während des
  Stundenlaufs (:01 bis etwa :13) war die Sperre belegt, dann scheiterten sofort
  alle Bereiche (22.09. 16:03, 29.09. 09:05 UTC). Wurde der Tab geschlossen, brach
  Cloudflare den Lauf ab; der Lauf vom 23.09. steht bis heute auf `running`.
- Fix: neuer Workflow `DirectSyncWorkflow` (`src/worker/direct-sync-workflow.ts`).
  `POST /api/admin/v1/matool/sync` startet ihn und antwortet sofort (202);
  `GET` liefert den Stand. Er wartet minütlich auf das Ende eines laufenden
  Abrufs (höchstens 30 Minuten), läuft dann ohne Wiederholung genau einmal und
  unabhängig vom Browser. Ein Doppelklick startet keinen zweiten Lauf
  (`matool_manual_sync_requests`, selbst angelegt, gleich `0012_manueller_abruf.sql`).
- Dashboard zeigt „angefordert“, „wartet auf den Stundenlauf“, „läuft“ und das
  Ergebnis; nach Neuladen der Seite wird ein laufender Abruf weiter angezeigt.
  **Nicht im Browser geprüft** (Dashboard hinter Passwort); nur Typecheck.

## 4. Fortschrittsbalken

- Neue Karte oben im Dashboard, sobald ein Abruf läuft (Stundenlauf oder manuell),
  auch wenn die Seite erst mitten im Lauf geöffnet wird: Gesamtbalken in Prozent,
  Startzeit, voraussichtliches Ende, je Bereich „fertig“, „läuft“, „wartet“ oder
  „Fehler“. Ein angeforderter manueller Abruf, der auf den Stundenlauf wartet, wird
  ebenfalls angezeigt.
- Schätzung (`src/worker/sync-progress.ts`): Durchschnitt der letzten fünf
  erfolgreichen Läufe je Bereich mit demselben Auslöser; dauert ein Bereich länger,
  wächst die Schätzung mit, der Balken bleibt unter 100 %. Ein Bereich meldet sich
  erst am Ende; innerhalb des laufenden Bereichs ist der Balken daher geschätzt.
  Nur Läufe mit gehaltener Sperre gelten als aktiv (der hängende Lauf vom 23.09.
  erscheint nicht). Der Interessenten-Workflow ist nicht enthalten.
- Abfrage alle 10 Sekunden während eines Laufs, sonst jede Minute; nach dem Ende
  lädt das Dashboard neu. Version `e3e63399-7ad5-45f9-b7e3-f8a5c3920b27`
  (09:55 UTC). Optisch lokal mit Beispielwerten geprüft, nicht mit echter Anmeldung.

## Verifiziert

- `main` + Fixes: `tsc` für Worker, Web, Node, Test ohne Fehler; **36 Dateien /
  562 Tests** grün (neu: 12 Ex-Parser-, 2 Stilllegungs-, 5 Workflow-Fälle);
  Build-Identität 3/3; Repository-Prüfung und Dry-run erfolgreich. Zapier-App
  unverändert, ihre Tests hier nicht gelaufen.
- Gegenproben: Ex- und Stilllegungs-Annahmetests scheitern mit der alten Regel.
- Live: siehe oben; `/healthz` `ok`, Status-Endpunkt ohne Anmeldung 401.

## Zu beachten

- Kein aktives Zapier-Abo außer einem deaktivierten `interessenten_details`; die 40
  neuen Ex-Mitglieder und die Stilllegungen lösen nichts aus.
- Remote nicht angewendet: Migrationen 0010 (Login-Bremse), 0011 (Stichtage), 0012
  (manueller Abruf). Alle Tabellen legt der Worker bei Bedarf selbst an.
- Ein manueller Abruf, der um :00 noch läuft, belegt die Sperre; der Stundenlauf
  scheitert dann in allen Bereichen (unverändertes Verhalten, nicht behoben).
- Der alte `running`-Lauf vom 23.09. ist nicht bereinigt.

## Offen

Fixes per Pull Request in `main`; Stundenlauf 10:00 UTC auswerten; unveränderter
Wiederholungslauf für Ex-Mitglieder; Knopf einmal im Dashboard testen; danach
Tagesabnahme (elf von elf Läufen).

## Nachtrag 29.09. nachmittags: Stand im Branch `claude/happy-dijkstra-anrzt6`

- **Übernommen:** Ex-Mitglieder-Fix und Entfernung des anonymen Vollzugriffs
  aus `f73d428`; der Stilllegungs-Fix (Formular-Eintrag ohne Stilllegung =
  leer) nach der Beschreibung oben neu gebaut, mit Gegenprobe gegen den alten
  Parser. Nicht übernommen: `outputs/…/.artifact-runtime/` (3.117 Dateien,
  Windows-Binärdateien; gehört nicht ins Repository).
- **Neu:** Zeitbudget für den Stundenlauf. Cloudflare beendet Cron-Aufrufe
  nach 15 Minuten Wandzeit; mit den Stilllegungen lief der Stundenlauf länger
  und wurde in den Graduierungen abgebrochen, die Stilllegungen kamen nie dran.
  Reihenfolge jetzt: Listen, Stilllegungen, Stammdaten, Graduierungen, jeweils
  mit eigenem Zeitbudget; abgebrochene Läufe werden nach 30 Minuten als
  `matool_run_aborted` abgeschlossen.
- **Weiterhin nur auf Staging, in keinem Repository:** `DirectSyncWorkflow`
  (manueller Abruf als Workflow, `0012_manueller_abruf.sql`) und die
  Fortschrittskarte (`src/worker/sync-progress.ts`). Ein Merge nach `main`
  deployt ohne sie. Achtung beim Nachziehen: Die Migration heißt ebenfalls
  `0012_…` wie `0012_detail_rotation.sql` – eine davon umbenennen (`0013_…`).

## Nachtrag 29.09. abends: Umbau Transport, Datenbank, Anzeige

Branch `claude/friendly-lovelace-hmom74`. Lokal geprüft (Typecheck, 581 Tests,
Worker-Build, Zapier-Paket), **nicht live ausgerollt** – das passiert beim
Merge nach `main`.

### Transport MATOOL → Hub

| Vorher | Jetzt |
| --- | --- |
| Stundenlauf im Cron-Aufruf, hart nach 15 Min. beendet | Cron startet nur den Workflow `stunde_<Stunde>`; kein Wandzeitlimit |
| Ein Fehler oder Deploy = Bereich/Lauf verloren | jeder Bereich ein eigener Schritt; nur der betroffene Bereich wird wiederholt (30 s, 2 min); Deploy setzt fort |
| Sperre je Bereich neu, Knopf und Stundenlauf konnten sich überholen | eine Sperre für den ganzen Lauf (Besitzer = Workflow) |
| Interessenten-Details: jede Stunde alle ~3.500 neu (≈ 3.500 Anfragen/h), parallel zum Mitgliederabruf | nur neue, geänderte, die 150 neuesten und je Stunde ein Elftel des Bestands (jedes Detail 1× täglich, ohne Morgenspitze); startet erst nach dem Mitgliederabruf |
| Ex-Mitglieder (67 Seiten, doppelt gelesen) jede Stunde | einmal täglich, manuell immer |
| 2 Versuche bei Verbindungsabbruch, 5xx nur bei Interessenten wiederholt | 3 Versuche mit wachsender Pause; 429/5xx bei allen Listenseiten |
| abgelaufene MATOOL-Sitzung = Bereich scheitert | Loginseite erkannt → einmal neu anmelden, Seite erneut lesen |

Grobe Schätzung aus Paketgrößen (nicht live gemessen): statt rund 3.500 bis
4.000 MATOOL-Anfragen je Stunde (davon ~3.500 Interessenten-Details) je
Stunde etwa 450 Interessenten-Details plus Listen und Mitglieder-Details,
gleichmäßig über den Tag verteilt. Die Interessentenliste wird bei kurzen
Abgleichen nur noch einmal statt zweimal gelesen; Ex-Mitglieder einmal
täglich.

### Datenbank

- Fehlender Index `matool_snapshot_changes(run_id)`: Jede Speicherung zählte
  ihre Änderungen über die ganze Historie (84.000+ Zeilen). Jetzt Index,
  selbst angelegt vom Worker (`db-maintenance.ts`) und in Migration 0013.
- Selbstlaufende Fristen für rein technische Hilfsdaten (Fortschrittszeilen
  alter Interessentenjobs, Laufpläne, übersprungene Läufe > 30 Tage,
  Diagnosen > 60 Tage, manuelle Aufträge > 90 Tage). Keine Fachdaten.
- Tabellenübersicht und Aufbewahrung: [datenbank.md](datenbank.md).
- **Offen, bewusst nicht automatisch:** `interessenten_sync_staged_lists`
  (~242.000 Zeilen, ungenutzt, teils vor der Verschlüsselung gespeichert)
  entfernen. Befehl und Rückweg stehen in datenbank.md.

### Dashboard

- Tabelle: Name, Status, 1. Probetraining, Kontakt, Angelegt, Quelle (bzw.
  Mitglieder: Name, Nr., Vertrag, Beginn, Beitrag, Kontakt) statt der ersten
  vier Rohfelder (ID, Datum, Anrede 0/1, Vorname).
- Werte lesbar (Datum deutsch, leer statt 0000-00-00, Ja/Nein, Uhrzeit, Euro),
  Detailansicht in Abschnitten, Fehlercodes mit Erklärung, echte Umlaute.
- Bugs: „Gespeichert“ zeigte für alle Bereiche außer Interessenten/Mitglieder
  0; mehrere veraltete Bereiche jetzt eine Sammelwarnung statt vieler Karten.

### Nach dem Merge beobachten

1. Erster Stundenlauf: Dashboard-Fortschrittskarte zeigt Bereiche einzeln.
2. Morgens 09:00: Ex-Mitglieder (dauert etwas länger), danach stündlich nur
   Mitglieder-Listen und Details.
3. Cloudflare → Workflows → `matool-direct-sync-staging`: je Stunde eine
   Instanz `stunde_…`, Status „Complete“.
