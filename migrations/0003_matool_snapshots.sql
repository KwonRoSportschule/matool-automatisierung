PRAGMA foreign_keys = ON;

CREATE TABLE matool_snapshot_runs (
  run_id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  fetched_count INTEGER NOT NULL CHECK (fetched_count >= 0),
  success_count INTEGER NOT NULL CHECK (success_count >= 0),
  failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
  error_code TEXT,
  CHECK (
    (status = 'succeeded' AND failure_count = 0 AND error_code IS NULL)
    OR
    (status = 'failed' AND success_count = 0 AND failure_count > 0 AND error_code IS NOT NULL)
  )
);

CREATE INDEX idx_matool_snapshot_runs_area_started
  ON matool_snapshot_runs (area, started_at DESC);

CREATE TABLE matool_snapshots (
  area TEXT NOT NULL,
  source_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  last_run_id TEXT NOT NULL,
  PRIMARY KEY (area, source_id),
  FOREIGN KEY (last_run_id) REFERENCES matool_snapshot_runs(run_id)
);

CREATE INDEX idx_matool_snapshots_area_last_seen
  ON matool_snapshots (area, last_seen_at DESC);
