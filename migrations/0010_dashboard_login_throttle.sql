-- Fehlgeschlagene Dashboard-Anmeldungen je Herkunft. Die IP-Adresse liegt
-- nur als HMAC vor; der Wartungslauf loescht Zeilen nach einem Tag.
-- Der Worker legt die Tabelle bei Bedarf identisch selbst an.
CREATE TABLE IF NOT EXISTS dashboard_login_throttle (
  bucket TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL CHECK (failure_count > 0),
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_login_throttle_updated
  ON dashboard_login_throttle (updated_at);
