PRAGMA foreign_keys = ON;

-- Genau ein fortsetzbarer Interessenten-Abgleich ist gleichzeitig aktiv.
-- Die fachlichen Datensaetze bleiben in matool_snapshots; diese Tabelle
-- enthaelt ausschliesslich den dauerhaften Fortschritt des aktuellen Jobs.
CREATE TABLE interessenten_sync_jobs (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  list_digest TEXT NOT NULL CHECK (
    length(list_digest) = 64
    AND list_digest NOT GLOB '*[^0-9a-f]*'
  ),
  list_count INTEGER NOT NULL CHECK (list_count > 0),
  list_run_id TEXT NOT NULL,
  initial_list_count INTEGER NOT NULL CHECK (initial_list_count >= 0),
  initial_list_unique_count INTEGER NOT NULL CHECK (
    initial_list_unique_count >= 0
    AND initial_list_unique_count <= initial_list_count
  ),
  list_created_count INTEGER NOT NULL DEFAULT 0 CHECK (list_created_count >= 0),
  list_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (list_updated_count >= 0),
  completed_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (
    completed_detail_count >= 0
  ),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  stale_list_removed_count INTEGER NOT NULL DEFAULT 0 CHECK (
    stale_list_removed_count >= 0
  ),
  stale_detail_removed_count INTEGER NOT NULL DEFAULT 0 CHECK (
    stale_detail_removed_count >= 0
  ),
  last_error_code TEXT,
  CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
  ),
  FOREIGN KEY (list_run_id) REFERENCES matool_snapshot_runs(run_id)
);

-- Macht Fortschrittsupdates bei Workflow-Retries exakt einmal wirksam.
CREATE TABLE interessenten_sync_progress_batches (
  job_id TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  completed_detail_count INTEGER NOT NULL CHECK (completed_detail_count >= 0),
  created_count INTEGER NOT NULL CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
  error_count INTEGER NOT NULL CHECK (error_count >= 0),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, batch_key)
);

-- Das Ergebnis eines Listen-Persists bleibt auch dann abrufbar, wenn ein
-- Workflow nach dem D1-Commit neu gestartet wird.
CREATE TABLE matool_snapshot_run_results (
  run_id TEXT PRIMARY KEY,
  created_count INTEGER NOT NULL CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
  stale_removed_count INTEGER NOT NULL CHECK (stale_removed_count >= 0),
  FOREIGN KEY (run_id) REFERENCES matool_snapshot_runs(run_id)
);
