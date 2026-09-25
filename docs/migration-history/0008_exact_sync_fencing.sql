PRAGMA foreign_keys = ON;

-- Eine globale Lease serialisiert alle direkten manuellen und geplanten
-- MATOOL-Schreiber. Der monoton steigende Token verhindert, dass ein alter
-- Lauf nach einer Lease-Uebernahme noch Current-Set-Daten committen kann.
CREATE TABLE IF NOT EXISTS matool_exact_sync_leases (
  lease_name TEXT PRIMARY KEY CHECK (lease_name = 'direct_snapshots'),
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Jeder fachliche Persist-Batch beginnt mit einem Guard-Upsert. Die Trigger
-- brechen den gesamten atomaren D1-Batch ab, falls Owner, Token oder Ablauf
-- nicht mehr zur aktiven Lease passen.
CREATE TABLE IF NOT EXISTS matool_exact_sync_fence_checks (
  lease_name TEXT PRIMARY KEY CHECK (lease_name = 'direct_snapshots'),
  owner_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  checked_at TEXT NOT NULL
);

-- Die zugehörigen Trigger werden von ensureExactSyncSafetySchema in der
-- Worker-Anwendung idempotent angelegt. Das vermeidet einen bekannten
-- Statement-Splitter-Fehler von Wrangler bei Trigger-Migrationsdateien.
