PRAGMA foreign_keys = ON;

-- Nachweis des Gleichstands zwischen MATOOL und Datenbank.
-- Ein Eintrag je Pruefdurchgang. Enthaelt ausschliesslich Mengen und
-- Zustaende, keine Personendaten.
CREATE TABLE matool_parity_runs (
  parity_id     TEXT PRIMARY KEY,
  area          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('liste', 'stichprobe', 'vollstaendig')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL,
  matool_count  INTEGER NOT NULL CHECK (matool_count >= 0),
  db_count      INTEGER NOT NULL CHECK (db_count >= 0),
  equal_count   INTEGER NOT NULL CHECK (equal_count >= 0),
  differing     INTEGER NOT NULL CHECK (differing >= 0),
  missing_in_db INTEGER NOT NULL CHECK (missing_in_db >= 0),
  surplus_in_db INTEGER NOT NULL CHECK (surplus_in_db >= 0),
  repaired      INTEGER NOT NULL DEFAULT 0 CHECK (repaired >= 0),
  status        TEXT NOT NULL CHECK (status IN ('parity', 'drift', 'failed'))
);

CREATE INDEX idx_matool_parity_runs_zeit
  ON matool_parity_runs (area, started_at DESC);
