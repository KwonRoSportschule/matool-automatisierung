PRAGMA foreign_keys = ON;

-- Kurzlebige Struktur-Diagnose fuer unerwartete MATOOL-Antworten.
-- Enthaelt ausschliesslich Formangaben: Laenge, Typ, Schluessel- und
-- Feldnamen. Keine Werte, keine Personendaten.
CREATE TABLE IF NOT EXISTS matool_response_shapes (
  shape_id    TEXT PRIMARY KEY,
  area        TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  shape_json  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matool_response_shapes_zeit
  ON matool_response_shapes (area, observed_at DESC);
