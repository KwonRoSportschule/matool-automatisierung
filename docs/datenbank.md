# Datenbank (Cloudflare D1) – Übersicht

Stand: 29.09.2026. Gilt für Staging und Produktion (gleiches Schema).

Diese Seite erklärt jede Tabelle in einem Satz, ordnet sie einer Gruppe zu und
nennt ihre Aufbewahrung. Personendaten liegen ausschließlich in `payload_json`
und sind dort AES-256-GCM-verschlüsselt (`enc:v1:…`).

## Grundprinzip in drei Sätzen

1. **`matool_snapshots` ist der aktuelle Bestand**: genau eine Zeile je
   Bereich und MATOOL-Kennung (`area`, `source_id`).
2. **`matool_snapshot_changes` ist die Historie**: eine Zeile je Neuanlage
   oder inhaltlicher Änderung – daraus speisen sich Dashboard-Verlauf und
   Zapier-Feed.
3. **`matool_sync_runs` → `matool_snapshot_runs`** protokollieren jeden Lauf:
   ein Gesamtlauf, darunter je Bereich ein Bereichslauf.

```text
matool_sync_runs (Gesamtlauf)
   └── matool_snapshot_runs (je Bereich, sync_id)
          ├── matool_snapshots.last_run_id       aktueller Bestand
          └── matool_snapshot_changes.run_id     Änderungshistorie
```

## Bereiche (`area`)

| Bereich | Inhalt | Quelle / Takt |
| --- | --- | --- |
| `interessenten` | Interessentenliste (Nr., Datum, Name, Status) | Interessenten-Workflow, stündlich |
| `interessenten_details` | Detail je Interessent (Kontakt, Probetraining …) | neue, geänderte, die 150 neuesten und je Stunde ein Elftel (jedes Detail 1× täglich, spätestens nach 48 h) |
| `schueler` | Mitgliederliste | stündlich, zweifach gelesen und verglichen |
| `schueler_ex` | Ehemalige Mitglieder | einmal täglich (erster Lauf), manuell immer |
| `checkin` | Check-ins der aktuellen Woche | stündlich |
| `schueler_stilllegungen` | Stilllegungszeiträume je Mitglied | rotierend, bis 120 je Lauf |
| `schueler_details` | Mitglieder-Stammdaten | rotierend, bis 150 je Lauf |
| `graduierungen` | Prüfungen / Graduierungen | rotierend, bis 200 je Lauf |

## Tabellen nach Gruppe

### 1. Fachdaten (werden nie automatisch gelöscht)

| Tabelle | Zweck |
| --- | --- |
| `matool_snapshots` | Aktueller Bestand je Bereich und MATOOL-Kennung. `public_id` ist die anonyme Referenz im Dashboard (`REC-…`). |
| `matool_snapshot_changes` | Änderungshistorie. Nach 30 Tagen bleibt von überholten Ständen nur die Metadatenzeile (`payload_json = NULL`); der neueste Stand und noch nicht an Zapier zugestellte Änderungen bleiben vollständig. |
| `beitrags_stichtage` | Gesicherter Stand der Beitragsübersicht am 1. und 15. jedes Monats. |

### 2. Laufprotokoll

| Tabelle | Zweck | Aufbewahrung |
| --- | --- | --- |
| `matool_sync_runs` | Ein Gesamtlauf (Stundenlauf oder manuell): Status, Mengen, Fehlercode. | Echte Läufe unbegrenzt; *übersprungene* Läufe 30 Tage |
| `matool_snapshot_runs` | Ein Bereichslauf innerhalb eines Gesamtlaufs. | unbegrenzt (Referenzziel der Historie) |
| `matool_snapshot_run_results` | Ergebniszähler eines Listenlaufs, damit eine Wiederholung idempotent ist. | unbegrenzt |
| `matool_sync_run_plans` | Welche Bereiche ein laufender Lauf lesen will (Fortschrittskarte). | nur solange der Lauf läuft |
| `matool_manual_sync_jobs` | Aufträge über den Knopf „Manuellen Abruf starten“. | 90 Tage nach Abschluss |
| `interessenten_sync_jobs` | Der aktuelle Interessentenabgleich (genau eine Zeile). | wird überschrieben |
| `interessenten_sync_progress_batches` | Fortschritt je Detailpaket des laufenden Interessentenabgleichs. | nur für den aktuellen Job |

### 3. Steuerung und Sperren

| Tabelle | Zweck |
| --- | --- |
| `matool_exact_sync_leases` | Die eine Abrufsperre (`direct_snapshots`). Der Workflow hält sie für den ganzen Lauf; jede Übernahme erhöht den Fencing-Token. |
| `matool_exact_sync_fence_checks` | Technische Prüfzeile: Ein Speicher-Batch mit abgelaufener Sperre wird von D1 komplett zurückgerollt. |
| `matool_detail_rotation` | Wann eine Graduierung je Mitglied zuletzt gelesen wurde (Mitglieder ohne Prüfung haben keinen Datensatz). |
| `dashboard_login_throttle` | Bremse gegen Passwort-Raten am Dashboard; abgelaufene Einträge werden stündlich entfernt. |
| `process_config` | Modus des Interessenten-Kontaktprozesses (`disabled` … `active`). |

### 4. Diagnose

| Tabelle | Zweck | Aufbewahrung |
| --- | --- | --- |
| `matool_response_shapes` | Personendatenfreie Strukturbeschreibung einer MATOOL-Antwort, die nicht zum Parser passte. | 60 Tage |
| `matool_parity_runs` | Ergebnisse von Paritätsprüfungen MATOOL ↔ D1. | unbegrenzt (klein) |

### 5. Zapier

| Tabelle | Zweck |
| --- | --- |
| `zapier_snapshot_subscriptions` | REST-Hook-Abos auf den Änderungsfeed eines Bereichs; `last_delivered_change_id` ist der Zustellzeiger. |
| `zapier_subscriptions` | REST-Hook-Abos für Pilot-Ereignisse (Interessenten-Kontakt). |

### 6. Pilot „Interessenten vor dem ersten Probetraining“ (deaktiviert)

`runs`, `records`, `events`, `outbox`, `deliveries`, `delivery_tokens`,
`event_claims`. Das Schema des Kontakt-Piloten nach
[architecture.md](architecture.md). Der Code ist vorhanden, erzeugt aber
keine Ereignisse, solange `process_config.mode` nicht `active` ist. Die
Tabellen sind leer bzw. klein und bleiben stehen, weil sie über
Fremdschlüssel verbunden sind.

## Selbstlaufende Pflege

`src/worker/db-maintenance.ts` läuft bei jedem Cron-Aufruf (auch außerhalb
des Zeitfensters) und braucht keine manuell angewendete Migration:

- legt fehlende Indizes an (`idx_matool_snapshot_changes_run` usw.),
- löscht rein technische Hilfsdaten nach den Fristen oben,
- entfernt **keine** Tabellen und **keine** Fachdaten.

Dieselben Indizes stehen in `migrations/0013_laufindizes.sql` für frische
Umgebungen. `src/worker/data-protection.ts` verschlüsselt Altbestand und
leert überholte Historienstände nach 30 Tagen.

## Offene Entscheidung: verwaiste Tabellen entfernen

Kein Code liest oder schreibt diese Tabellen mehr. Sie werden bewusst **nicht
automatisch** gelöscht; das Entfernen ist eine einmalige Entscheidung.

| Tabelle | Warum verwaist | Hinweis |
| --- | --- | --- |
| `interessenten_sync_staged_lists` | Zwischenablage eines früheren Interessentenabgleichs, ersetzt durch den vollständigen Listenabruf. | Zuletzt rund 242.000 Zeilen, **teils aus der Zeit vor der Verschlüsselung** – also möglicherweise Klartext-Personendaten. Größter Einzelposten der Datenbank. |
| `matool_manual_sync_requests` | Überbleibsel eines nie committeten Standes auf Staging. | ersetzt durch `matool_manual_sync_jobs` |
| `collector_state`, `leases` | Nie beschriebene Tabellen des ersten Pilotentwurfs. | ohne Fremdschlüssel auf sie |

Empfohlenes Vorgehen (Staging, danach Produktion):

```text
# 1. Zeilen zählen (nur lesend)
pnpm exec wrangler d1 execute matool-middleware-staging --remote --env staging \
  --command "SELECT COUNT(*) FROM interessenten_sync_staged_lists"

# 2. Entfernen (D1 Time Travel hält 30 Tage einen Rückweg bereit)
pnpm exec wrangler d1 execute matool-middleware-staging --remote --env staging \
  --command "DROP TABLE IF EXISTS interessenten_sync_staged_lists; DROP TABLE IF EXISTS matool_manual_sync_requests;"
```

Rückweg bei Bedarf: `wrangler d1 time-travel restore matool-middleware-staging
--env staging --timestamp <Zeitpunkt vor dem DROP>`.

## Bekannte Altlast in der Historie

Bis zum 10.09.2026 flossen Darstellungsfelder (`columnCount`, `tableIndex`) in
den Inhalts-Hash. Dadurch enthält `matool_snapshot_changes` für Interessenten
rund 66.000 Schein-Änderungen (`updated`) aus dieser Zeit. Seit dem Fix
entstehen keine neuen. Ob der Altbestand gekennzeichnet, archiviert oder ab
einem Stichtag abgeschnitten wird, ist offen (siehe
[fehler-und-datenbank-todo-2026-09-22.md](fehler-und-datenbank-todo-2026-09-22.md)).
