PRAGMA foreign_keys = ON;

CREATE TABLE event_claims (
  event_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  delivery_id TEXT NOT NULL UNIQUE,
  claimed_by TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  review_after TEXT NOT NULL,
  confirmed_at TEXT,
  outcome TEXT CHECK (outcome IN ('succeeded', 'failed')),
  failure_code TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(event_id),
  FOREIGN KEY (delivery_id) REFERENCES delivery_tokens(delivery_id)
);

CREATE INDEX idx_event_claims_unconfirmed
  ON event_claims (confirmed_at, claimed_at);

CREATE TABLE delivery_tokens (
  delivery_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (outbox_id, attempt_number),
  FOREIGN KEY (outbox_id) REFERENCES outbox(outbox_id),
  FOREIGN KEY (event_id) REFERENCES events(event_id)
);

CREATE INDEX idx_delivery_tokens_expiry
  ON delivery_tokens (expires_at);

CREATE TABLE zapier_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_zapier_subscriptions_active
  ON zapier_subscriptions (status, event_type);

CREATE UNIQUE INDEX ux_zapier_subscriptions_one_active_event
  ON zapier_subscriptions (event_type)
  WHERE status = 'active';
