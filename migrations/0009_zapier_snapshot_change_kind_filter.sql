PRAGMA foreign_keys = ON;

ALTER TABLE zapier_snapshot_subscriptions
  ADD COLUMN change_kind_filter TEXT NOT NULL DEFAULT 'any'
  CHECK (change_kind_filter IN ('any', 'created', 'updated'));

-- Bestehende "nur geändert"-Subscriptions behalten exakt ihr bisheriges
-- Verhalten. Alle anderen empfangen weiterhin beide Ereignisarten.
UPDATE zapier_snapshot_subscriptions
SET change_kind_filter = CASE
  WHEN only_changed = 1 THEN 'updated'
  ELSE 'any'
END;

CREATE INDEX idx_zapier_snapshot_subscriptions_active_kind
  ON zapier_snapshot_subscriptions (status, area, change_kind_filter);
