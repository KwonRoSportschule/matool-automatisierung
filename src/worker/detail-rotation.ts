/**
 * Rotation fuer Abrufe je Mitglied, deren Ergebnis nicht genau einen
 * Datensatz je Mitglied hat.
 *
 * Stammdaten und Stilllegungen speichern je Mitglied genau einen Datensatz;
 * dessen last_seen_at zeigt, wer am laengsten nicht gelesen wurde. Die
 * Graduierungen speichern dagegen je Pruefung einen Datensatz und fuer
 * Mitglieder ohne Pruefung gar keinen. Deshalb merkt sich diese Tabelle, wann
 * ein Mitglied zuletzt abgefragt wurde -- nur Kennung und Zeitpunkt.
 */

interface RotationCandidateRow {
  source_id: string;
}

/**
 * Deployment-sichere Schema-Anlage wie in beitrags-archiv.ts: Der
 * GitHub-Deploy wendet D1-Migrationen nicht an. Die Definition entspricht
 * migrations/0012_detail_rotation.sql.
 */
export async function ensureDetailRotationSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS matool_detail_rotation (
        area TEXT NOT NULL,
        source_id TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (area, source_id)
      )`
    )
    .run();
}

/**
 * Mitglieder der aktuellen Mitgliederliste in Abrufreihenfolge: noch nie
 * abgefragte zuerst, danach die am laengsten nicht abgefragten.
 */
export async function selectRotatingSourceIds(
  db: D1Database,
  area: string,
  limit: number
): Promise<string[]> {
  await ensureDetailRotationSchema(db);
  const candidates = await db
    .prepare(
      `SELECT liste.source_id
       FROM matool_snapshots AS liste
       LEFT JOIN matool_detail_rotation AS rotation
         ON rotation.area = ?
        AND rotation.source_id = liste.source_id
       WHERE liste.area = 'schueler'
         AND length(liste.source_id) BETWEEN 1 AND 32
         AND liste.source_id NOT GLOB '*[^0-9]*'
       ORDER BY
         CASE WHEN rotation.source_id IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(rotation.read_at, liste.first_seen_at) ASC,
         liste.source_id ASC
       LIMIT ?`
    )
    .bind(area, limit)
    .all<RotationCandidateRow>();

  return candidates.results
    .map((row) => row.source_id)
    .filter((sourceId) => /^\d{1,32}$/u.test(sourceId));
}

/**
 * Haelt fest, dass diese Mitglieder gerade abgefragt wurden, und entfernt
 * Eintraege von Mitgliedern, die nicht mehr in der Mitgliederliste stehen.
 */
export async function markRotationRead(
  db: D1Database,
  area: string,
  sourceIds: readonly string[],
  readAt: string
): Promise<void> {
  await ensureDetailRotationSchema(db);
  const ids = sourceIds.filter((sourceId) => /^\d{1,32}$/u.test(sourceId));
  await db.batch([
    ...(ids.length > 0
      ? [
          db
            .prepare(
              `INSERT INTO matool_detail_rotation (area, source_id, read_at)
               SELECT ?, value, ? FROM json_each(?)
               WHERE true
               ON CONFLICT (area, source_id) DO UPDATE SET read_at = excluded.read_at`
            )
            .bind(area, readAt, JSON.stringify(ids))
        ]
      : []),
    db
      .prepare(
        `DELETE FROM matool_detail_rotation
         WHERE area = ?
           AND source_id NOT IN (
             SELECT source_id FROM matool_snapshots WHERE area = 'schueler'
           )`
      )
      .bind(area)
  ]);
}
