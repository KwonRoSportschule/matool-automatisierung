-- Rotation der Abrufe je Mitglied, fuer Bereiche ohne genau einen Datensatz
-- je Mitglied (Graduierungen: je Pruefung ein Datensatz, ohne Pruefung
-- keiner). Haelt nur die MATOOL-Kennung und den Zeitpunkt des letzten
-- Abrufs, keine Inhalte. Die Definition entspricht
-- src/worker/detail-rotation.ts (ensureDetailRotationSchema).
CREATE TABLE IF NOT EXISTS matool_detail_rotation (
  area TEXT NOT NULL,
  source_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (area, source_id)
);
