PRAGMA foreign_keys = ON;

CREATE TABLE matool_sync_runs (
  sync_id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled')),
  scheduled_for TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'succeeded', 'partial_failed', 'failed', 'skipped')
  ),
  skip_reason TEXT,
  area_count INTEGER NOT NULL DEFAULT 0 CHECK (area_count >= 0),
  succeeded_area_count INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_area_count >= 0),
  failed_area_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_area_count >= 0),
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  stored_count INTEGER NOT NULL DEFAULT 0 CHECK (stored_count >= 0),
  new_count INTEGER NOT NULL DEFAULT 0 CHECK (new_count >= 0),
  changed_count INTEGER NOT NULL DEFAULT 0 CHECK (changed_count >= 0),
  error_code TEXT
);

CREATE INDEX idx_matool_sync_runs_scheduled
  ON matool_sync_runs (trigger_kind, scheduled_for DESC);

CREATE INDEX idx_matool_sync_runs_started
  ON matool_sync_runs (started_at DESC);

ALTER TABLE matool_snapshot_runs ADD COLUMN sync_id TEXT;

CREATE INDEX idx_matool_snapshot_runs_sync
  ON matool_snapshot_runs (sync_id, started_at);

ALTER TABLE matool_snapshots ADD COLUMN public_id TEXT;
ALTER TABLE matool_snapshots ADD COLUMN last_changed_at TEXT;

UPDATE matool_snapshots
SET public_id = lower(hex(randomblob(16))),
    last_changed_at = first_seen_at
WHERE public_id IS NULL OR last_changed_at IS NULL;

CREATE UNIQUE INDEX ux_matool_snapshots_public_id
  ON matool_snapshots (public_id);

CREATE INDEX idx_matool_snapshots_area_first_seen
  ON matool_snapshots (area, first_seen_at DESC, public_id);

CREATE INDEX idx_matool_snapshots_area_changed
  ON matool_snapshots (area, last_changed_at DESC, public_id);

CREATE TABLE matool_snapshot_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  source_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created', 'updated')),
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE (area, source_id, run_id),
  FOREIGN KEY (run_id) REFERENCES matool_snapshot_runs(run_id)
);

CREATE INDEX idx_matool_snapshot_changes_observed
  ON matool_snapshot_changes (observed_at DESC);

CREATE INDEX idx_matool_snapshot_changes_area_observed
  ON matool_snapshot_changes (area, observed_at DESC);

-- Bestehende Datensaetze erhalten einen nachweisbaren Startpunkt. Historische
-- Aenderungen vor dieser Migration lassen sich aus dem aktuellen Snapshot
-- nicht verlaesslich rekonstruieren und werden deshalb nicht erfunden.
INSERT OR IGNORE INTO matool_snapshot_changes (
  area,
  source_id,
  run_id,
  change_kind,
  observed_at,
  content_hash
)
SELECT
  area,
  source_id,
  last_run_id,
  'created',
  first_seen_at,
  content_hash
FROM matool_snapshots;
