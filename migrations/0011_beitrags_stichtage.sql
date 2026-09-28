-- Tagesstaende der Beitragsuebersicht fuer die Klassenauswertung.
--
-- Je Kalendertag (Europe/Berlin) genau eine Zeile: der letzte vollstaendige
-- Stand dieses Tages. Die Kennzahlen stehen als Klartext-Spalten fuer den
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
  payload_json TEXT NOT NULL
);
