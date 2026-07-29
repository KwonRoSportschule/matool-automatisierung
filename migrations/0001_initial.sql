PRAGMA foreign_keys = ON;

CREATE TABLE process_config (
  process_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('disabled', 'dry_run', 'shadow', 'active')),
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  collector TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'shadow', 'active')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled', 'test')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  scheduled_for TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  error_code TEXT,
  fencing_token INTEGER,
  FOREIGN KEY (collector) REFERENCES process_config(process_key)
);

CREATE INDEX idx_runs_collector_started
  ON runs (collector, started_at DESC);

CREATE TABLE collector_state (
  collector TEXT PRIMARY KEY,
  baseline_completed_at TEXT,
  last_success_at TEXT,
  last_complete_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collector) REFERENCES process_config(process_key)
);

CREATE TABLE records (
  collector TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  payload_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  PRIMARY KEY (collector, source_key),
  FOREIGN KEY (collector) REFERENCES process_config(process_key),
  FOREIGN KEY (last_run_id) REFERENCES runs(run_id)
);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  collector TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'shadow_ready',
      'approved',
      'queued',
      'transport_accepted',
      'action_confirmed',
      'cancelled',
      'failed'
    )
  ),
  created_run_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fencing_token INTEGER NOT NULL,
  FOREIGN KEY (collector, source_key) REFERENCES records(collector, source_key),
  FOREIGN KEY (created_run_id) REFERENCES runs(run_id)
);

CREATE INDEX idx_events_status_created
  ON events (status, created_at);

CREATE TABLE outbox (
  outbox_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'in_flight', 'retry_wait', 'accepted', 'permanent_failure')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, destination),
  FOREIGN KEY (event_id) REFERENCES events(event_id)
);

CREATE INDEX idx_outbox_due
  ON outbox (status, next_attempt_at);

CREATE TABLE deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('accepted', 'retryable_error', 'permanent_error', 'timeout')
  ),
  http_status INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  UNIQUE (event_id, destination, attempt_number),
  FOREIGN KEY (event_id) REFERENCES events(event_id)
);

CREATE TABLE leases (
  lease_key TEXT PRIMARY KEY,
  owner_run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_run_id) REFERENCES runs(run_id)
);

INSERT INTO process_config (
  process_key,
  display_name,
  mode,
  policy_version,
  config_json
) VALUES (
  'interessenten_first_trial',
  'Interessenten vor dem ersten Probetraining',
  'disabled',
  1,
  '{"contactLeadMinutes":null,"lookbackMinutes":null,"contactChannel":null}'
);

INSERT INTO collector_state (collector)
VALUES ('interessenten_first_trial');
