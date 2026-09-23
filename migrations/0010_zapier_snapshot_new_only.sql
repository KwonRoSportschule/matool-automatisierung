ALTER TABLE zapier_snapshot_subscriptions
  ADD COLUMN only_new INTEGER NOT NULL DEFAULT 0 CHECK (only_new IN (0, 1));
