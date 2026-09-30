import { AppError } from "../core/app-error";

export type MatoolSyncTrigger = "manual" | "scheduled";
export type MatoolSyncSkipReason =
  | "outside_schedule_window"
  | "matool_not_configured"
  | "real_runs_not_confirmed"
  | "lease_busy"
  | "previous_run_active"
  | "workflow_unavailable";

export interface MatoolSyncSummary {
  failed: number;
  storedTotal: number;
  succeeded: number;
  totalAreas: number;
}

export async function beginMatoolSyncRun(
  db: D1Database,
  input: {
    scheduledFor?: string;
    startedAt: string;
    trigger: MatoolSyncTrigger;
  }
): Promise<string> {
  const syncId = `sync_${crypto.randomUUID()}`;
  try {
    await db
      .prepare(
        `INSERT INTO matool_sync_runs (
           sync_id, trigger_kind, scheduled_for, started_at, status
         ) VALUES (?, ?, ?, ?, 'running')`
      )
      .bind(
        syncId,
        input.trigger,
        input.scheduledFor ?? null,
        input.startedAt
      )
      .run();
  } catch {
    throw syncStoreError();
  }
  return syncId;
}

/**
 * Ab diesem Alter gilt ein Lauf, der noch "laeuft", als abgebrochen.
 * Cloudflare beendet einen Cron-Aufruf nach 15 Minuten ohne Vorwarnung;
 * der Lauf kommt dann nie bis finishMatoolSyncRun. Die Grenze liegt
 * deutlich ueber der Lease (20 Minuten), damit kein lebender Lauf
 * getroffen wird.
 */
export const MATOOL_SYNC_RUN_ABANDONED_AFTER_MS = 30 * 60 * 1_000;

/**
 * Schliesst Laeufe ab, die seit mehr als 30 Minuten "laufen": Sie wurden
 * abgebrochen (Wandzeitlimit, Neustart). Ohne das zeigt das Dashboard sie
 * dauerhaft als laufend. Scheitert nie am neuen Lauf.
 */
export async function markAbandonedMatoolSyncRuns(
  db: D1Database,
  now: string
): Promise<number> {
  const grenze = new Date(
    Date.parse(now) - MATOOL_SYNC_RUN_ABANDONED_AFTER_MS
  ).toISOString();
  try {
    const result = await db
      .prepare(
        `UPDATE matool_sync_runs
         SET status = 'failed',
             finished_at = ?,
             error_code = 'matool_run_aborted'
         WHERE status = 'running'
           AND started_at < ?`
      )
      .bind(now, grenze)
      .run();
    return result.meta.changes ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Merkt sich, welche Bereiche ein Lauf lesen will (fuer die
 * Fortschrittskarte). Eigene, selbst angelegte Tabelle; scheitert nie am Lauf.
 */
export async function recordMatoolSyncRunPlan(
  db: D1Database,
  syncId: string,
  areas: readonly string[]
): Promise<void> {
  try {
    await db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS matool_sync_run_plans (
          sync_id TEXT PRIMARY KEY,
          areas_json TEXT NOT NULL
        )`
      ),
      db
        .prepare(
          `INSERT OR REPLACE INTO matool_sync_run_plans (sync_id, areas_json)
           VALUES (?, ?)`
        )
        .bind(syncId, JSON.stringify([...areas]))
    ]);
  } catch {
    // Nur fuer die Anzeige; ohne Plan zeigt die Karte alle Bereiche.
  }
}

/** Geplante Bereiche eines Laufs oder null, wenn keiner hinterlegt ist. */
export async function readMatoolSyncRunPlan(
  db: D1Database,
  syncId: string
): Promise<string[] | null> {
  try {
    const row = await db
      .prepare("SELECT areas_json FROM matool_sync_run_plans WHERE sync_id = ?")
      .bind(syncId)
      .first<{ areas_json: string }>();
    const areas = row ? (JSON.parse(row.areas_json) as unknown) : null;
    return Array.isArray(areas) && areas.every((area) => typeof area === "string")
      ? (areas as string[])
      : null;
  } catch {
    return null;
  }
}

export async function finishMatoolSyncRun(
  db: D1Database,
  syncId: string,
  finishedAt: string,
  summary: MatoolSyncSummary
): Promise<void> {
  const status =
    summary.failed === 0
      ? "succeeded"
      : summary.succeeded === 0
        ? "failed"
        : "partial_failed";
  try {
    const result = await db
      .prepare(
        `UPDATE matool_sync_runs
         SET finished_at = ?,
             status = ?,
             area_count = ?,
             succeeded_area_count = ?,
             failed_area_count = ?,
             fetched_count = COALESCE((
               SELECT SUM(fetched_count)
               FROM matool_snapshot_runs
               WHERE sync_id = ?
             ), 0),
             stored_count = ?,
             new_count = COALESCE((
               SELECT COUNT(*)
               FROM matool_snapshot_changes AS changes
               INNER JOIN matool_snapshot_runs AS area_runs
                 ON area_runs.run_id = changes.run_id
               WHERE area_runs.sync_id = ?
                 AND changes.change_kind = 'created'
             ), 0),
             changed_count = COALESCE((
               SELECT COUNT(*)
               FROM matool_snapshot_changes AS changes
               INNER JOIN matool_snapshot_runs AS area_runs
                 ON area_runs.run_id = changes.run_id
               WHERE area_runs.sync_id = ?
                 AND changes.change_kind = 'updated'
             ), 0),
             error_code = ?
         WHERE sync_id = ?
           AND status = 'running'`
      )
      .bind(
        finishedAt,
        status,
        summary.totalAreas,
        summary.succeeded,
        summary.failed,
        syncId,
        summary.storedTotal,
        syncId,
        syncId,
        summary.failed > 0 ? "one_or_more_areas_failed" : null,
        syncId
      )
      .run();
    if (result.meta.changes !== 1) {
      throw syncStoreError();
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

export async function recordSkippedMatoolSync(
  db: D1Database,
  input: {
    reason: MatoolSyncSkipReason;
    scheduledFor: string;
  }
): Promise<void> {
  const syncId = `sync_${crypto.randomUUID()}`;
  try {
    await db
      .prepare(
        `INSERT INTO matool_sync_runs (
           sync_id, trigger_kind, scheduled_for, started_at, finished_at,
           status, skip_reason
         ) VALUES (?, 'scheduled', ?, ?, ?, 'skipped', ?)`
      )
      .bind(
        syncId,
        input.scheduledFor,
        input.scheduledFor,
        input.scheduledFor,
        input.reason
      )
      .run();
  } catch {
    throw syncStoreError();
  }
}

function syncStoreError(): AppError {
  return new AppError(
    "matool_sync_store_unavailable",
    503,
    "Der Status des MATOOL-Gesamtlaufs konnte nicht gespeichert werden."
  );
}
