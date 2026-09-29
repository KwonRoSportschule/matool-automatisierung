/**
 * Manuell angeforderte Gesamtabrufe (Knopf im Dashboard).
 *
 * Der Knopf lief frueher synchron in der Web-Anfrage: 5 bis 7 Minuten, und
 * er scheiterte sofort, wenn der Stundenlauf die Sperre hielt, oder brach ab,
 * wenn der Tab geschlossen wurde. Jetzt legt er hier einen Auftrag an und
 * startet den DirectSyncWorkflow, der auf die Sperre wartet und genau einmal
 * laeuft. Die Tabelle haelt nur Zeitpunkte, Status und Zaehler -- keine
 * Personendaten.
 *
 * Eigener Tabellenname: Ein frueherer, nie committeter Stand hat auf
 * Staging bereits "matool_manual_sync_requests" mit unbekanntem Aufbau
 * angelegt. Die bleibt unangetastet.
 */

export type ManualSyncStatus =
  | "requested"
  | "waiting"
  | "running"
  | "succeeded"
  | "partial_failed"
  | "failed";

export interface ManualSyncJob {
  jobId: string;
  requestedAt: string;
  status: ManualSyncStatus;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  storedTotal: number;
  succeeded: number;
  failed: number;
  failedAreas: string[];
  errorCode: string | null;
}

interface ManualSyncJobRow {
  job_id: string;
  requested_at: string;
  status: ManualSyncStatus;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  stored_total: number;
  succeeded: number;
  failed: number;
  failed_areas: string;
  error_code: string | null;
}

const OPEN_STATUSES = ["requested", "waiting", "running"] as const;

/**
 * Ein offener Auftrag ohne Lebenszeichen seit so langer Zeit gilt als
 * verloren (Workflow abgebrochen) und blockiert keinen neuen Abruf.
 */
export const MANUAL_SYNC_STALE_AFTER_MS = 60 * 60 * 1_000;

export async function ensureManualSyncSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS matool_manual_sync_jobs (
        job_id TEXT PRIMARY KEY,
        requested_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('requested', 'waiting', 'running', 'succeeded', 'partial_failed', 'failed')
        ),
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        stored_total INTEGER NOT NULL DEFAULT 0,
        succeeded INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        failed_areas TEXT NOT NULL DEFAULT '[]',
        error_code TEXT
      )`
    )
    .run();
}

function fromRow(row: ManualSyncJobRow): ManualSyncJob {
  let failedAreas: string[] = [];
  try {
    const parsed = JSON.parse(row.failed_areas) as unknown;
    if (Array.isArray(parsed)) {
      failedAreas = parsed.filter((area): area is string => typeof area === "string");
    }
  } catch {
    failedAreas = [];
  }
  return {
    jobId: row.job_id,
    requestedAt: row.requested_at,
    status: row.status,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    storedTotal: Number(row.stored_total ?? 0),
    succeeded: Number(row.succeeded ?? 0),
    failed: Number(row.failed ?? 0),
    failedAreas,
    errorCode: row.error_code
  };
}

/** Der neueste Auftrag, offen oder abgeschlossen. */
export async function latestManualSyncJob(db: D1Database): Promise<ManualSyncJob | null> {
  await ensureManualSyncSchema(db);
  const row = await db
    .prepare(
      `SELECT * FROM matool_manual_sync_jobs
       ORDER BY requested_at DESC, job_id DESC
       LIMIT 1`
    )
    .first<ManualSyncJobRow>();
  return row ? fromRow(row) : null;
}

/**
 * Der offene Auftrag, falls es einen gibt. Verwaiste Auftraege (seit einer
 * Stunde ohne Lebenszeichen) werden dabei als fehlgeschlagen abgeschlossen.
 */
export async function openManualSyncJob(
  db: D1Database,
  now: Date = new Date()
): Promise<ManualSyncJob | null> {
  await ensureManualSyncSchema(db);
  const grenze = new Date(now.getTime() - MANUAL_SYNC_STALE_AFTER_MS).toISOString();
  await db
    .prepare(
      `UPDATE matool_manual_sync_jobs
       SET status = 'failed', error_code = 'manual_sync_abandoned',
           finished_at = ?, updated_at = ?
       WHERE status IN ('requested', 'waiting', 'running')
         AND updated_at < ?`
    )
    .bind(now.toISOString(), now.toISOString(), grenze)
    .run();
  const row = await db
    .prepare(
      `SELECT * FROM matool_manual_sync_jobs
       WHERE status IN (${OPEN_STATUSES.map(() => "?").join(", ")})
       ORDER BY requested_at DESC, job_id DESC
       LIMIT 1`
    )
    .bind(...OPEN_STATUSES)
    .first<ManualSyncJobRow>();
  return row ? fromRow(row) : null;
}

export async function createManualSyncJob(
  db: D1Database,
  jobId: string,
  now: Date = new Date()
): Promise<ManualSyncJob> {
  await ensureManualSyncSchema(db);
  const iso = now.toISOString();
  await db
    .prepare(
      `INSERT INTO matool_manual_sync_jobs (job_id, requested_at, status, updated_at)
       VALUES (?, ?, 'requested', ?)`
    )
    .bind(jobId, iso, iso)
    .run();
  return {
    jobId,
    requestedAt: iso,
    status: "requested",
    updatedAt: iso,
    startedAt: null,
    finishedAt: null,
    storedTotal: 0,
    succeeded: 0,
    failed: 0,
    failedAreas: [],
    errorCode: null
  };
}

/** Wartet auf die Sperre bzw. laeuft jetzt. */
export async function markManualSyncJob(
  db: D1Database,
  jobId: string,
  status: "waiting" | "running",
  now: Date = new Date()
): Promise<void> {
  await ensureManualSyncSchema(db);
  const iso = now.toISOString();
  await db
    .prepare(
      `UPDATE matool_manual_sync_jobs
       SET status = ?, updated_at = ?,
           started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END
       WHERE job_id = ? AND status IN ('requested', 'waiting', 'running')`
    )
    .bind(status, iso, status, iso, jobId)
    .run();
}

export async function finishManualSyncJob(
  db: D1Database,
  jobId: string,
  result: {
    errorCode?: string | null;
    failed: number;
    failedAreas: readonly string[];
    storedTotal: number;
    succeeded: number;
  },
  now: Date = new Date()
): Promise<void> {
  await ensureManualSyncSchema(db);
  const status: ManualSyncStatus =
    result.errorCode || (result.failed > 0 && result.succeeded === 0)
      ? "failed"
      : result.failed > 0
        ? "partial_failed"
        : "succeeded";
  const iso = now.toISOString();
  await db
    .prepare(
      `UPDATE matool_manual_sync_jobs
       SET status = ?, updated_at = ?, finished_at = ?,
           stored_total = ?, succeeded = ?, failed = ?,
           failed_areas = ?, error_code = ?
       WHERE job_id = ?`
    )
    .bind(
      status,
      iso,
      iso,
      result.storedTotal,
      result.succeeded,
      result.failed,
      JSON.stringify([...result.failedAreas]),
      result.errorCode ?? null,
      jobId
    )
    .run();
}

/** Haelt ein Abruf gerade die Sperre fuer die direkten Bereiche? */
export async function isDirectSyncLeaseHeld(
  db: D1Database,
  now: Date = new Date()
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `SELECT 1 AS belegt FROM matool_exact_sync_leases
         WHERE lease_name = 'direct_snapshots' AND expires_at > ?`
      )
      .bind(now.toISOString())
      .first<{ belegt: number }>();
    return row !== null;
  } catch {
    // Ohne Tabelle hat noch nie jemand die Sperre genommen.
    return false;
  }
}
