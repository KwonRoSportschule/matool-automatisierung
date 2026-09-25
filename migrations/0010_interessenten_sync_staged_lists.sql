PRAGMA foreign_keys = ON;

-- Lange paginierte Interessentenlisten werden erst intern vollständig
-- gesammelt. Erst der Workflow-Commit macht sie atomar als aktuellen
-- Bestand sichtbar.
CREATE TABLE IF NOT EXISTS interessenten_sync_staged_lists (
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
