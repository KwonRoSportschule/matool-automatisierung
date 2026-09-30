-- Laufindizes (29.09.2026).
--
-- Entspricht MAINTENANCE_INDEXES in src/worker/db-maintenance.ts, das
-- dieselben Indizes bei jedem Cron-Aufruf selbst anlegt (ein Deploy aus
-- GitHub wendet Migrationen nicht an). Diese Datei haelt frische Umgebungen
-- und die Testkette gleich. Alle Anweisungen sind idempotent und aendern
-- keine Daten.

-- Jede Speicherung zaehlt ihre Aenderungen ueber run_id; ohne Index lief das
-- bei jedem Bereich ueber die gesamte Aenderungshistorie.
CREATE INDEX IF NOT EXISTS idx_matool_snapshot_changes_run
  ON matool_snapshot_changes (run_id);

-- Letzter Erfolg je Bereich (Schrumpfschutz, Faelligkeit der Ex-Mitglieder).
CREATE INDEX IF NOT EXISTS idx_matool_snapshot_runs_area_status_finished
  ON matool_snapshot_runs (area, status, finished_at DESC);

-- Laufende Gesamtlaeufe (Fortschrittskarte, Abbrucherkennung).
CREATE INDEX IF NOT EXISTS idx_matool_sync_runs_status_started
  ON matool_sync_runs (status, started_at DESC);
