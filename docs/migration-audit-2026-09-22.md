# Migrationsabgleich vom 22.09.2026

Der lesende Abgleich ergab zwei fehlende historische Schemaerweiterungen und
zwei bereits angewendete Varianten vorhandener Migrationen. Die lokale
Reparatur ist inzwischen umgesetzt und in der echten lokalen D1-Testumgebung
mit fünf bestandenen Tests abgenommen. Die 13 ausführbaren Dateien erzeugen
das benötigte Schema; zwei zusätzliche historische Namen sind archiviert.
Die erneute lesende Remote-Prüfung meldet `No migrations to apply!`.

## Umsetzungsstand und Abnahme

- Wiederhergestellt: `migrations/0009_zapier_snapshot_change_kind_filter.sql`
  und `migrations/0010_interessenten_sync_staged_lists.sql`.
- Archiviert: `docs/migration-history/0007_diagnose.sql` und
  `docs/migration-history/0008_exact_sync_fencing.sql`; die zugehörige README
  erklärt die ausführbaren Entsprechungen und den Live-Ledger-Abgleich.
- Alle vier übernommenen Dateien stimmen nach Normalisierung der Zeilenenden
  und abschließender Leerzeichen mit dem erhaltenen zweiten Checkout überein.
  Der zweite Checkout blieb unverändert.
- `test/migration-schema.test.ts` prüft über den bestehenden D1-Testaufbau
  eine frische Migrationskette ohne Schema-Reparaturen durch Anwendungscode:
  historische Dateinamen, fehlende Staging-Spalten und Primärschlüssel,
  beide Zapier-Filtergenerationen samt Index, beide Fence-Trigger sowie die
  unveränderte Wiederanwendung ohne Fremdschlüsselfehler.
- Ausgeführt: `node_modules/.bin/vitest.CMD run test/migration-schema.test.ts`
  mit Ergebnis **5/5 bestanden** und
  `node_modules/.bin/tsc.CMD -p tsconfig.test.json --noEmit` ohne Fehler.
  Vitest benötigte wegen `spawn EPERM` die Freigabe für seine lokalen
  Vite-/D1-Unterprozesse; der freigegebene Test lief erfolgreich.
- Danach ausschließlich lesend ausgeführt:
  `node_modules/.bin/wrangler.CMD d1 migrations list matool-middleware-staging --remote --env staging`.
  Ergebnis: **Keine ausstehenden Migrationen**. Die 15 angewendeten Namen
  erklären sich vollständig aus 13 ausführbaren Dateien und zwei
  dokumentierten historischen Varianten.
- Noch separat offen: gemeinsame Git-Versionierung mit der geprüften
  Anwendungsversion und deren Deployment. Ein generischer automatisierter
  Remote-Ledger-Vergleich ist ein möglicher zusätzlicher Betriebscheck; die
  Abnahme dieser Reparatur beruht auf dem dokumentierten Live-Audit und der
  erneut abgefragten leeren Pending-Liste.

Eine neue Remote-Migration, eine Änderung des Live-Ledgers oder ein
Deployment war für diese lokale Reparatur nicht erforderlich und wurde
nicht ausgeführt. Neue inhaltliche Migrationen beginnen weiterhin mit `0011`.

## Umfang und Belege

- Datenbank: `matool-middleware-staging`, Umgebung `staging`.
- Gelesen: `d1_migrations` und `sqlite_schema`, keine fachlichen Datensätze.
- Beide D1-Abfragen bestätigen `rows_written: 0`, `changed_db: false`.
- Datenbankgröße bei der Abfrage: 171.859.968 Byte.
- Werkzeug: vorhandenes Wrangler 4.115.0; der Sandbox-Start scheiterte mit
  `spawn EPERM`, die erneut freigegebene lesende Abfrage war erfolgreich.
- Geprüfter Haupt-Checkout: `91bc1751b9f1694ad7b95713cd419b35f4083e23`, mit
  vorhandenen uncommitteten Änderungen.
- Zweiter registrierter Checkout:
  `C:/Users/CorinKeil/.codex/worktrees/fb26/matool-automatisierung`, HEAD
  `e37ca8f56989c600fdf0014b323791a57d416434`, ebenfalls mit vorhandenen Änderungen.
  Dieser Checkout wurde ausschließlich gelesen.

Die Migrationshistorie in D1 speichert Dateinamen und Anwendungszeit, aber keine
Inhaltsprüfsummen. Die unten wiedergefundenen Dateien sind daher erhaltene
lokale Quellen, deren DDL mit dem Live-Schema vereinbar ist. Ihre damalige
bytegenaue Ausführung lässt sich aus `d1_migrations` allein nicht beweisen.

## Tatsächlich angewendete Migrationen beim ursprünglichen Audit

Alle elf derzeit im Haupt-Checkout vorhandenen SQL-Dateien sind bereits in
Staging angewendet. Vier weitere Dateinamen stehen zusätzlich im Live-Ledger.
Die Zeiten sind unverändert aus D1 übernommen.

| ID | Dateiname | Angewendet |
| --- | --- | --- |
| 1 | `0001_initial.sql` | 2026-07-29 13:45:24 |
| 2 | `0002_zapier_delivery_guards.sql` | 2026-07-29 13:45:25 |
| 3 | `0003_matool_snapshots.sql` | 2026-07-30 10:30:21 |
| 4 | `0004_dashboard_history.sql` | 2026-08-03 14:13:04 |
| 5 | `0005_zapier_snapshot_changefeed.sql` | 2026-08-19 12:17:28 |
| 6 | `0006_interessenten_full_sync.sql` | 2026-08-24 14:28:25 |
| 7 | `0007_exact_sync_fencing.sql` | 2026-08-24 14:28:49 |
| 8 | `0008_diagnose.sql` | 2026-08-24 18:30:54 |
| 9 | `0009_paritaet.sql` | 2026-08-25 09:37:36 |
| 10 | `0007_diagnose.sql` | 2026-08-25 12:06:43 |
| 11 | `0008_exact_sync_fencing.sql` | 2026-08-25 12:12:30 |
| 12 | `0009_zapier_snapshot_change_kind_filter.sql` | 2026-08-25 12:12:31 |
| 13 | `0010_interessenten_sync_staged_lists.sql` | 2026-08-25 13:13:16 |
| 14 | `0010_darstellungsfelder_entfernen.sql` | 2026-09-10 07:58:58 |
| 15 | `0010_zapier_snapshot_new_only.sql` | 2026-09-10 07:58:59 |

Die beiden zuletzt genannten Dateien sind im Haupt-Checkout noch unversioniert,
aber bereits live angewendet. Sie dürfen nicht nachträglich umbenannt werden.

## Wiedergefundene Quellen und Schemaabweichungen

Alle vier im Haupt-Checkout fehlenden Dateien liegen im Migrationsordner des
zweiten Checkouts. `git log --all --reflog` findet für drei dieser Dateinamen
keine versionierte Fassung. `0007_diagnose.sql` existiert zusätzlich im Commit
`0e27d07`; diese ältere Fassung ist jedoch nicht idempotent.

| Historische Datei | Zustand im zweiten Checkout | Behandlung |
| --- | --- | --- |
| `0007_diagnose.sql` | Modifiziert; Tabelle und Index verwenden `IF NOT EXISTS` | Unter unverändertem Namen außerhalb der ausführbaren Kette archivieren |
| `0008_exact_sync_fencing.sql` | Umbenannte/modifizierte Datei; zwei Tabellen, keine Trigger | Unter unverändertem Namen außerhalb der ausführbaren Kette archivieren |
| `0009_zapier_snapshot_change_kind_filter.sql` | Unversioniert; Spalte, Backfill, Index | Originaldatei unter demselben Namen in `migrations/` wieder aufnehmen |
| `0010_interessenten_sync_staged_lists.sql` | Unversioniert; Tabelle mit zwei Hash-Checks | Originaldatei unter demselben Namen in `migrations/` wieder aufnehmen |

SHA-256 der gelesenen Quelldateien vor jeglicher Wiederherstellung:

```text
0007_diagnose.sql
12FE8327B48B496BA6841BF5DAC11CE769153B4954CCAA9ED7595B0F698A1CCF
0008_exact_sync_fencing.sql
B84BE3D2D9C2C1B7DE2706E6E3555CC89A61E623802BC9CEC06757246ED1AF57
0009_zapier_snapshot_change_kind_filter.sql
E4A80658CE88661BCC67BFCB1536B309608DD916B555E0405390B6FE650B5D99
0010_interessenten_sync_staged_lists.sql
517DCCC21D1E7FC3A5025C97FB4C3558B910EB5FE12E3488453B0F0A70729139
```

Die Live-Tabelle `zapier_snapshot_subscriptions` besitzt zusätzlich zur lokalen
Migrationskette die folgende Spalte und den folgenden Index:

```sql
change_kind_filter TEXT NOT NULL DEFAULT 'any'
  CHECK (change_kind_filter IN ('any', 'created', 'updated'))

CREATE INDEX idx_zapier_snapshot_subscriptions_active_kind
  ON zapier_snapshot_subscriptions (status, area, change_kind_filter);
```

Die wiedergefundene Migration befüllt `change_kind_filter` mit `updated`, wenn
`only_changed = 1` gilt, sonst mit `any`. Das heutige `only_new` ist eine
separate, bereits vorhandene Spalte und ersetzt diese Historie nicht.

Die folgende Tabelle existiert live und fehlt in der lokalen Kette. Dies ist
das aus `sqlite_schema` gelesene DDL mit ausschließlich angepasster Einrückung:

```sql
CREATE TABLE interessenten_sync_staged_lists (
  job_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  zapier_event_id TEXT NOT NULL CHECK (
    length(zapier_event_id) = 64
    AND zapier_event_id NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (job_id, source_id)
);
```

Die Fence-Tabellen und beide Fence-Trigger existieren live und stimmen
inhaltlich mit `0007_exact_sync_fencing.sql` des Haupt-Checkouts überein. Die
historische `0008_exact_sync_fencing.sql` legt nur die Tabellen idempotent an
und verweist für Trigger auf damaligen Anwendungscode. Daraus folgt kein
Bedarf, die funktionierenden heutigen Trigger zu entfernen.

Auch `matool_response_shapes` und sein Index existieren live. Die beiden
Diagnose-Dateinamen stehen für dieselben Schemaobjekte.

## Lokaler Reproduktionsnachweis

Es wurden drei vollständig neue SQLite-In-Memory-Datenbanken mit Node.js
`node:sqlite` angelegt. Die SQL-Dateien wurden nach Dateinamen sortiert und
vollständig ausgeführt; anschließend erfolgte `PRAGMA foreign_key_check`.
Dabei wurden weder lokale Datenbankdateien noch Remote-Daten geändert.

| Ausführbare Kette | Ergebnis |
| --- | --- |
| Aktuelle elf Dateien | Erfolgreich; 23 Anwendungstabellen; `staged_lists` und `change_kind_filter` fehlen |
| Aktuelle Dateien plus die zwei oben empfohlenen Originaldateien | Erfolgreich; 24 Anwendungstabellen; beide fehlenden Schemaanteile sowie `only_new` vorhanden; null Fremdschlüsselfehler |
| Aktuelle Dateien plus alle vier historischen Dateien | Fehler in `0008_diagnose.sql`: `table matool_response_shapes already exists` |

Staging enthält zusätzlich die verwalteten Tabellen `d1_migrations` und
`_cf_KV`; damit erklärt sich die beobachtete Gesamtzahl von 26 Tabellen.
Der erste In-Memory-Test prüfte SQLite-DDL und Reihenfolge. Die anschließend
ergänzte und oben dokumentierte D1-Testdatei erfüllt nun auch die Prüfung mit
dem tatsächlich verwendeten Cloudflare-Migrationsleser und der lokalen
D1-Laufzeit, einschließlich beider Fence-Trigger.

## Konkreter Reparaturplan

1. Die zwei wiedergefundenen fachlich zusätzlichen Migrationen unter ihren
   bestehenden Namen in `migrations/` wieder aufnehmen. Inhalte aus dem
   zweiten Checkout übernehmen, nicht aus dem Live-Schema neu erfinden.
2. Die zwei doppelten historischen Varianten beispielsweise unter
   `docs/migration-history/` unter ihren Originaldateinamen archivieren.
   Ihr Manifest dokumentiert den ersetzenden ausführbaren Dateinamen und
   warum sie nicht ein zweites Mal in einer frischen Kette laufen dürfen.
3. Die elf bestehenden ausführbaren Dateien unverändert erhalten und die
   beiden schon live angewendeten, derzeit unversionierten `0010`-Dateien in
   die Versionierung aufnehmen. Keine Live-Ledger-Zeilen löschen, umbenennen
   oder nachträglich mit neu erfundenen historischen Inhalten versehen.
4. Einen lesenden Migrationscheck hinzufügen: Jeder lokale ausführbare Name
   muss entweder bereits angewendet oder bewusst neu sein; jeder zusätzliche
   Live-Name muss exakt im historischen Manifest erklärt sein. Unbekannte
   zusätzliche Namen und fehlende notwendige Schemaobjekte müssen auffallen.
5. Die 13 ausführbaren Dateien auf einer frischen isolierten lokalen
   D1-Datenbank anwenden; Table-/Column-/Index-/Trigger-Struktur und
   Fremdschlüssel prüfen. Den zweiten Durchlauf auf leere Pending-Liste
   prüfen. Remote anschließend nur die Pending-Liste und Schema lesen;
   für diese Reparatur muss die Remote-Pending-Liste leer bleiben.
6. Für neue inhaltliche Schemaänderungen ab jetzt eine einzige neue Nummer
   pro Migration verwenden, beginnend mit `0011`. Der Abgleich selbst benötigt
   keine `0011` und insbesondere kein erneutes `ADD COLUMN change_kind_filter`.
   Eine spätere Retention- oder Lesemodell-Migration erhält dann die nächste
   freie Nummer; ihre fachliche Änderung wird separat getestet.

Die Migrationsreparatur allein gleicht den Anwendungscode nicht an: Im zweiten
Checkout liegt auch eine umfangreiche Implementierung mit
`stageInteressentenListPage` und `commitStagedInteressentenList`, während der
Haupt-Checkout die Staging-Tabelle überhaupt nicht referenziert. Vor einem
Deployment muss der aktive Workflow gegen diese erhaltene Implementierung
abgeglichen werden. Ein ungeprüfter Deploy des Haupt-Checkouts könnte sonst
die live verwendete Fortsetzungslogik ändern, obwohl sämtliche Migrationen
vorhanden sind.

Der ursprüngliche Audit war vollständig lesend. Die anschließende lokale
Reparatur ergänzte vier historische SQL-Dateien an den oben dokumentierten
Orten, Archivdokumentation und den Regressionstest. Bestehende SQL-Dateien
blieben unverändert; es erfolgten keine Remote-Schreibzüge und kein Deployment.

Referenz für die lesenden Wrangler-Befehle:
[Cloudflare D1 – Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).
