PRAGMA foreign_keys = ON;

ALTER TABLE matool_snapshot_changes ADD COLUMN payload_json TEXT;
ALTER TABLE matool_snapshot_changes ADD COLUMN zapier_event_id TEXT;

-- Vor dieser Migration wurde je Aenderung nur der Hash gespeichert. Exakt
-- rekonstruierbar ist deshalb nur die jeweils neueste Aenderung, deren Hash
-- noch dem aktuellen Snapshot entspricht. Sie behaelt die bisher von Zapier
-- gesehene ID, damit der Wechsel auf den Change-Feed nichts erneut ausloest.
UPDATE matool_snapshot_changes
SET payload_json = (
      SELECT snapshots.payload_json
      FROM matool_snapshots AS snapshots
      WHERE snapshots.area = matool_snapshot_changes.area
        AND snapshots.source_id = matool_snapshot_changes.source_id
        AND snapshots.content_hash = matool_snapshot_changes.content_hash
    ),
    zapier_event_id = area || ':' || source_id || ':' || substr(content_hash, 1, 16)
WHERE change_id IN (
  SELECT MAX(changes.change_id)
  FROM matool_snapshot_changes AS changes
  INNER JOIN matool_snapshots AS snapshots
    ON snapshots.area = changes.area
   AND snapshots.source_id = changes.source_id
   AND snapshots.content_hash = changes.content_hash
  GROUP BY changes.area, changes.source_id
);

CREATE UNIQUE INDEX ux_matool_snapshot_changes_zapier_event
  ON matool_snapshot_changes (zapier_event_id)
  WHERE zapier_event_id IS NOT NULL;

CREATE INDEX idx_matool_snapshot_changes_area_id
  ON matool_snapshot_changes (area, change_id);

CREATE INDEX idx_matool_snapshot_changes_area_kind_id
  ON matool_snapshot_changes (area, change_kind, change_id);

CREATE TABLE zapier_snapshot_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL UNIQUE,
  area TEXT NOT NULL,
  only_changed INTEGER NOT NULL CHECK (only_changed IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  last_delivered_change_id INTEGER NOT NULL DEFAULT 0
    CHECK (last_delivered_change_id >= 0),
  pending_change_id INTEGER,
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count >= 0),
  delivery_next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pending_change_id) REFERENCES matool_snapshot_changes(change_id)
);

CREATE INDEX idx_zapier_snapshot_subscriptions_active
  ON zapier_snapshot_subscriptions (status, area);

CREATE INDEX idx_zapier_snapshot_subscriptions_due
  ON zapier_snapshot_subscriptions (
    status,
    delivery_next_attempt_at,
    pending_change_id
  );
