/**
 * Selbstlaufende Datenbankpflege. Laeuft bei jedem Cron-Aufruf (auch
 * ausserhalb des MATOOL-Zeitfensters) und braucht keine manuell angewendete
 * Migration: Ein Deploy aus GitHub wendet D1-Migrationen nicht an, deshalb
 * muss alles hier idempotent und in kleinen, begrenzten Schritten passieren.
 *
 * Aufgaben:
 * 1. fehlende Indizes anlegen (vor allem `matool_snapshot_changes.run_id`:
 *    jede Speicherung zaehlt ihre Aenderungen ueber diese Spalte, ohne Index
 *    war das bei jedem Bereich ein Durchlauf ueber die ganze Historie);
 * 2. rein technische Hilfsdaten nach festen Fristen loeschen, damit die
 *    Datenbank nicht ungebremst waechst.
 *
 * Fachliche Daten (aktueller Bestand, Aenderungshistorie, Laufverlauf,
 * Beitragsstichtage) werden hier nie geloescht, und es werden keine Tabellen
 * entfernt. Verwaiste Tabellen und die Empfehlung dazu stehen in
 * docs/datenbank.md; ihr Entfernen bleibt eine bewusste Entscheidung.
 */

import { toAppError } from "../core/app-error";
import type { Env } from "./env";

/** Zeilen je Loeschanweisung; haelt jede Anweisung weit unter den D1-Grenzen. */
const DELETE_BATCH_ROWS = 2_000;
/** Hoechstens so viele Loeschrunden je Tabelle und Aufruf. */
const MAX_DELETE_ROUNDS = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Aufbewahrungsfristen rein technischer Hilfsdaten in Tagen. */
export const RETENTION_DAYS = {
  /** Uebersprungene Stundenlaeufe (ausserhalb des Zeitfensters usw.). */
  skippedSyncRuns: 30,
  /** Strukturdiagnosen von MATOOL-Antworten. */
  responseShapes: 60,
  /** Abgeschlossene manuelle Abrufauftraege. */
  manualSyncJobs: 90
} as const;

export const MAINTENANCE_INDEXES = [
  {
    name: "idx_matool_snapshot_changes_run",
    sql: `CREATE INDEX IF NOT EXISTS idx_matool_snapshot_changes_run
            ON matool_snapshot_changes (run_id)`
  },
  {
    name: "idx_matool_snapshot_runs_area_status_finished",
    sql: `CREATE INDEX IF NOT EXISTS idx_matool_snapshot_runs_area_status_finished
            ON matool_snapshot_runs (area, status, finished_at DESC)`
  },
  {
    name: "idx_matool_sync_runs_status_started",
    sql: `CREATE INDEX IF NOT EXISTS idx_matool_sync_runs_status_started
            ON matool_sync_runs (status, started_at DESC)`
  }
] as const;

export interface DatabaseMaintenanceResult {
  indexesEnsured: number;
  deleted: Record<string, number>;
}

export async function runDatabaseMaintenance(
  env: Env,
  now: Date = new Date()
): Promise<DatabaseMaintenanceResult> {
  const db = env.DB;
  const result: DatabaseMaintenanceResult = { deleted: {}, indexesEnsured: 0 };

  for (const index of MAINTENANCE_INDEXES) {
    if (await tryRun(db, index.sql)) {
      result.indexesEnsured += 1;
    }
  }

  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

  // Fortschrittszeilen dienen nur dazu, dass ein Batch des laufenden
  // Interessentenabgleichs nicht doppelt zaehlt. Zu frueheren Jobs haben sie
  // keine Funktion mehr (zuletzt ueber 14.000 Zeilen).
  result.deleted.interessenten_sync_progress_batches = await deleteInBatches(
    db,
    "interessenten_sync_progress_batches",
    `job_id NOT IN (SELECT job_id FROM interessenten_sync_jobs)`
  );
  // Plan eines Laufs: nur fuer die Fortschrittskarte, solange er laeuft.
  result.deleted.matool_sync_run_plans = await deleteInBatches(
    db,
    "matool_sync_run_plans",
    `sync_id NOT IN (SELECT sync_id FROM matool_sync_runs WHERE status = 'running')`
  );
  result.deleted.matool_sync_runs_skipped = await deleteInBatches(
    db,
    "matool_sync_runs",
    `status = 'skipped' AND started_at < ?`,
    [cutoff(RETENTION_DAYS.skippedSyncRuns)]
  );
  result.deleted.matool_response_shapes = await deleteInBatches(
    db,
    "matool_response_shapes",
    `observed_at < ?`,
    [cutoff(RETENTION_DAYS.responseShapes)]
  );
  result.deleted.matool_manual_sync_jobs = await deleteInBatches(
    db,
    "matool_manual_sync_jobs",
    `status NOT IN ('requested', 'waiting', 'running') AND requested_at < ?`,
    [cutoff(RETENTION_DAYS.manualSyncJobs)]
  );

  return result;
}

/** Wie runDatabaseMaintenance, aber ohne den Cron-Lauf abzubrechen. */
export async function runDatabaseMaintenanceSafely(
  env: Env,
  now: Date = new Date()
): Promise<void> {
  try {
    const result = await runDatabaseMaintenance(env, now);
    console.info(JSON.stringify({ event: "database_maintenance", ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "database_maintenance_failed",
        errorCode: toAppError(error).code
      })
    );
  }
}

/**
 * Loescht passende Zeilen in Bloecken, damit keine einzelne Anweisung an
 * D1-Zeitgrenzen stoesst. Fehlt die Tabelle oder eine Spalte (aeltere
 * Umgebung), passiert nichts.
 */
async function deleteInBatches(
  db: D1Database,
  table: string,
  where: string,
  bindings: readonly (string | number)[] = []
): Promise<number> {
  if (!(await tableExists(db, table))) {
    return 0;
  }
  let total = 0;
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    let changes: number;
    try {
      const result = await db
        .prepare(
          `DELETE FROM ${table}
           WHERE rowid IN (
             SELECT rowid FROM ${table} WHERE ${where} LIMIT ${DELETE_BATCH_ROWS}
           )`
        )
        .bind(...bindings)
        .run();
      changes = result.meta.changes ?? 0;
    } catch {
      return total;
    }
    total += changes;
    if (changes < DELETE_BATCH_ROWS) {
      break;
    }
  }
  return total;
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table)
      .first<{ present: number }>();
    return row !== null;
  } catch {
    return false;
  }
}

async function tryRun(db: D1Database, sql: string): Promise<boolean> {
  try {
    await db.prepare(sql).run();
    return true;
  } catch {
    return false;
  }
}
