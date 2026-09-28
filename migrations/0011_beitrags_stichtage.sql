-- Abrechnungsstichtage der Beitragsuebersicht fuer die Klassenauswertung.
--
-- Nur fuer den 1. und 15. eines Monats (Europe/Berlin) je eine Zeile: der
-- letzte vollstaendige Stand dieses Tages. einzug_json haelt die Summe je
-- Einzugstag (1 bis 31) ohne Personenbezug. Die Kennzahlen stehen als Klartext-Spalten fuer den
-- Verlauf; sie nennen keine Person. Namen und Einzelbetraege liegen nur in
-- payload_json und dort AES-256-GCM-verschluesselt (wie matool_snapshots).
CREATE TABLE IF NOT EXISTS beitrags_stichtage (
  stichtag TEXT PRIMARY KEY
    CHECK (stichtag GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  erstellt_am TEXT NOT NULL,
  vollstaendig INTEGER NOT NULL CHECK (vollstaendig IN (0, 1)),
  monatssumme_cent INTEGER NOT NULL,
  mitglieder_gesamt INTEGER NOT NULL,
  mit_beitrag INTEGER NOT NULL,
  ohne_beitrag INTEGER NOT NULL,
  stillgelegt INTEGER NOT NULL,
  ex_mitglieder INTEGER,
  einzug_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL
);
