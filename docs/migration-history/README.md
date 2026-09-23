# Historische, bereits angewendete Varianten

Diese Dateien gehören zur Staging-Migrationshistorie, werden aber nicht erneut
ausgeführt. Wrangler und die D1-Tests lesen ausschließlich `migrations/`.

| Archivierte Datei | Ausführbare Entsprechung | Grund |
| --- | --- | --- |
| `0007_diagnose.sql` | `migrations/0008_diagnose.sql` | Dieselbe Tabelle und derselbe Index; beide Dateien zusammen würden eine frische Kette bei `0008_diagnose.sql` abbrechen |
| `0008_exact_sync_fencing.sql` | `migrations/0007_exact_sync_fencing.sql` | Dieselben zwei Fence-Tabellen; die ausführbare Datei enthält zusätzlich die benötigten Trigger |

Die Originalnamen bleiben sowohl hier als auch im Live-Ledger erhalten. Die
Dateien wurden aus dem erhaltenen, unverändert gelassenen Checkout
`C:/Users/CorinKeil/.codex/worktrees/fb26/matool-automatisierung/migrations`
übernommen; bei der Aufnahme wurden nur Zeilenenden vereinheitlicht.

Der [Audit vom 22.09.2026](../migration-audit-2026-09-22.md) enthält
Quellprüfsummen, Anwendungszeiten, Schema-Belege und die geprüfte Reparatur.
Die zwei anderen dort wiedergefundenen Dateien ergänzen tatsächlich das Schema
und befinden sich deshalb unter ihren historischen Namen in `migrations/`.

Für den Abgleich mit Staging gilt: Jeder ausführbare Dateiname muss im
Live-Ledger stehen oder eine ausdrücklich neue Migration sein. Zusätzlich
angewendete Namen sind ausschließlich die beiden hier dokumentierten
Varianten. Weitere Unterschiede erfordern einen neuen Abgleich; die
Live-Historie wird nicht automatisch korrigiert.

Ab der nächsten inhaltlichen Migration wird jede Nummer nur einmal vergeben,
beginnend mit `0011`. Die schon angewendeten historischen Doppelnumerierungen
werden nicht nachträglich umbenannt.
