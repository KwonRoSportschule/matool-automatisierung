import { AppError } from "../core/app-error";

const INTERESSENTEN_AREA = "interessenten";
const INTERESSENTEN_DETAILS_AREA = "interessenten_details";
const MAX_INTERESSENTEN_COUNT = 20_000;
const MAX_DETAIL_BATCH_SIZE = 500;

export type InteressentenSyncJobStatus = "failed" | "running" | "succeeded";

export interface InteressentenSyncJob {
  completedDetailCount: number;
  createdCount: number;
  errorCount: number;
  finishedAt: string | null;
  initialListCount: number;
  initialListUniqueCount: number;
  jobId: string;
  lastErrorCode: string | null;
  listCount: number;
  listCreatedCount: number;
  listDigest: string;
  listRunId: string;
  listUpdatedCount: number;
  staleDetailRemovedCount: number;
  staleListRemovedCount: number;
  startedAt: string;
  status: InteressentenSyncJobStatus;
  updatedAt: string;
  updatedCount: number;
}

export interface StartInteressentenSyncJobInput {
  initialListCount: number;
  initialListUniqueCount: number;
  jobId: string;
  listCount: number;
  listCreatedCount: number;
  listDigest: string;
  listRunId: string;
  listUpdatedCount: number;
  staleListRemovedCount: number;
  startedAt: string;
}

export interface InteressentenSyncParity {
  detailCount: number;
  detailUnique: number;
  expectedListCount: number;
  extraDetails: number;
  listCount: number;
  listRunMismatch: number;
  listUnique: number;
  missingDetails: number;
  nonNumericListIds: number;
  staleDetails: number;
}

interface InteressentenSyncJobRow {
  completed_detail_count: number;
  created_count: number;
  error_count: number;
  finished_at: string | null;
  initial_list_count: number;
  initial_list_unique_count: number;
  job_id: string;
  last_error_code: string | null;
  list_count: number;
  list_created_count: number;
  list_digest: string;
  list_run_id: string;
  list_updated_count: number;
  stale_detail_removed_count: number;
  stale_list_removed_count: number;
  started_at: string;
  status: InteressentenSyncJobStatus;
  updated_at: string;
  updated_count: number;
}

interface InteressentenSyncParityRow {
  detail_count: number;
  detail_unique: number;
  expected_list_count: number;
  extra_details: number;
  list_count: number;
  list_run_mismatch: number;
  list_unique: number;
  missing_details: number;
  non_numeric_list_ids: number;
  stale_details: number;
}

interface SourceIdRow {
  source_id: string;
}

/**
 * Deployment-sichere, idempotente Schema-Anlage. GitHub-Deployments koennen
 * damit einen Job auch starten, wenn Wrangler die Migration noch nicht
 * separat angewendet hat.
 */
export async function ensureInteressentenSyncSchema(
  db: D1Database
): Promise<void> {
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS interessenten_sync_jobs (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        job_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        list_digest TEXT NOT NULL CHECK (
          length(list_digest) = 64
          AND list_digest NOT GLOB '*[^0-9a-f]*'
        ),
        list_count INTEGER NOT NULL CHECK (list_count > 0),
        list_run_id TEXT NOT NULL,
        initial_list_count INTEGER NOT NULL CHECK (initial_list_count >= 0),
        initial_list_unique_count INTEGER NOT NULL CHECK (
          initial_list_unique_count >= 0
          AND initial_list_unique_count <= initial_list_count
        ),
        list_created_count INTEGER NOT NULL DEFAULT 0 CHECK (list_created_count >= 0),
        list_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (list_updated_count >= 0),
        completed_detail_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_detail_count >= 0),
        created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
        updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
        error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
        stale_list_removed_count INTEGER NOT NULL DEFAULT 0 CHECK (stale_list_removed_count >= 0),
        stale_detail_removed_count INTEGER NOT NULL DEFAULT 0 CHECK (stale_detail_removed_count >= 0),
        last_error_code TEXT,
        CHECK (
          (status = 'running' AND finished_at IS NULL)
          OR (status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
        ),
        FOREIGN KEY (list_run_id) REFERENCES matool_snapshot_runs(run_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS interessenten_sync_progress_batches (
        job_id TEXT NOT NULL,
        batch_key TEXT NOT NULL,
        completed_detail_count INTEGER NOT NULL CHECK (completed_detail_count >= 0),
        created_count INTEGER NOT NULL CHECK (created_count >= 0),
        updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
        error_count INTEGER NOT NULL CHECK (error_count >= 0),
        applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, batch_key)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS matool_snapshot_run_results (
        run_id TEXT PRIMARY KEY,
        created_count INTEGER NOT NULL CHECK (created_count >= 0),
        updated_count INTEGER NOT NULL CHECK (updated_count >= 0),
        stale_removed_count INTEGER NOT NULL CHECK (stale_removed_count >= 0),
        FOREIGN KEY (run_id) REFERENCES matool_snapshot_runs(run_id)
      )`)
    ]);
  } catch {
    throw syncStoreError();
  }
}

/**
 * Beginnt einen Abgleich erst, nachdem der vollstaendige Listenlauf atomar
 * gespeichert und auf seinen exakten aktuellen Bestand reduziert wurde.
 * Ein anderer laufender Job wird fail-closed niemals uebernommen.
 */
export async function startOrRestartInteressentenSyncJob(
  db: D1Database,
  input: StartInteressentenSyncJobInput
): Promise<InteressentenSyncJob> {
  validateStartInput(input);

  try {
    await ensureInteressentenSyncSchema(db);
    await db
      .prepare(
        `INSERT INTO interessenten_sync_jobs (
           singleton, job_id, status, started_at, updated_at, finished_at,
           list_digest, list_count, list_run_id,
           initial_list_count, initial_list_unique_count,
           list_created_count, list_updated_count,
           completed_detail_count, created_count, updated_count, error_count,
           stale_list_removed_count, stale_detail_removed_count,
           last_error_code
         )
         SELECT
           1, ?, 'running', ?, ?, NULL,
           ?, ?, ?,
           ?, ?,
           ?, ?,
           0, ?, ?, 0,
           ?, 0,
           NULL
         FROM matool_snapshot_runs AS list_run
         WHERE list_run.run_id = ?
           AND list_run.area = 'interessenten'
           AND list_run.status = 'succeeded'
           AND list_run.failure_count = 0
           AND list_run.error_code IS NULL
           AND list_run.fetched_count = ?
           AND list_run.success_count = ?
           AND (
             SELECT COUNT(*)
             FROM matool_snapshots
             WHERE area = 'interessenten'
           ) = ?
           AND (
             SELECT COUNT(DISTINCT source_id)
             FROM matool_snapshots
             WHERE area = 'interessenten'
           ) = ?
           AND (
             SELECT COUNT(*)
             FROM matool_snapshots
             WHERE area = 'interessenten'
               AND last_run_id = ?
               AND length(source_id) BETWEEN 1 AND 32
               AND source_id NOT GLOB '*[^0-9]*'
           ) = ?
         ON CONFLICT(singleton) DO UPDATE SET
           job_id = excluded.job_id,
           status = excluded.status,
           started_at = excluded.started_at,
           updated_at = excluded.updated_at,
           finished_at = excluded.finished_at,
           list_digest = excluded.list_digest,
           list_count = excluded.list_count,
           list_run_id = excluded.list_run_id,
           initial_list_count = excluded.initial_list_count,
           initial_list_unique_count = excluded.initial_list_unique_count,
           list_created_count = excluded.list_created_count,
           list_updated_count = excluded.list_updated_count,
           completed_detail_count = excluded.completed_detail_count,
           created_count = excluded.created_count,
           updated_count = excluded.updated_count,
           error_count = excluded.error_count,
           stale_list_removed_count = excluded.stale_list_removed_count,
           stale_detail_removed_count = excluded.stale_detail_removed_count,
           last_error_code = excluded.last_error_code
         WHERE interessenten_sync_jobs.status <> 'running'`
      )
      .bind(
        input.jobId,
        input.startedAt,
        input.startedAt,
        input.listDigest,
        input.listCount,
        input.listRunId,
        input.initialListCount,
        input.initialListUniqueCount,
        input.listCreatedCount,
        input.listUpdatedCount,
        input.listCreatedCount,
        input.listUpdatedCount,
        input.staleListRemovedCount,
        input.listRunId,
        input.listCount,
        input.listCount,
        input.listCount,
        input.listCount,
        input.listRunId,
        input.listCount
      )
      .run();

    const job = await getCurrentInteressentenSyncJob(db);
    if (!job || !matchesStartInput(job, input)) {
      throw syncJobConflict();
    }
    return job;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

export async function getCurrentInteressentenSyncJob(
  db: D1Database
): Promise<InteressentenSyncJob | null> {
  try {
    await ensureInteressentenSyncSchema(db);
    const row = await db
      .prepare(`${JOB_SELECT_SQL} WHERE singleton = 1`)
      .first<InteressentenSyncJobRow>();
    return row ? mapJob(row) : null;
  } catch {
    throw syncStoreError();
  }
}

/**
 * Liefert nur IDs des exakten aktuellen Listenlaufs. Bereits seit Jobstart
 * erfolgreich gespeicherte Details werden beim Fortsetzen uebersprungen.
 */
export async function selectInteressentenSyncDetailSourceIds(
  db: D1Database,
  jobId: string,
  limit: number
): Promise<string[]> {
  validateIdentifier(jobId, 128);
  validateCount(limit, 1, MAX_DETAIL_BATCH_SIZE);

  try {
    await ensureInteressentenSyncSchema(db);
    const rows = await db
      .prepare(
        `SELECT current_list.source_id
         FROM interessenten_sync_jobs AS job
         INNER JOIN matool_snapshots AS current_list
           ON current_list.area = 'interessenten'
          AND current_list.last_run_id = job.list_run_id
         LEFT JOIN matool_snapshots AS details
           ON details.area = 'interessenten_details'
          AND details.source_id = current_list.source_id
         WHERE job.singleton = 1
           AND job.job_id = ?
           AND job.status = 'running'
           AND length(current_list.source_id) BETWEEN 1 AND 32
           AND current_list.source_id NOT GLOB '*[^0-9]*'
           AND (
             details.source_id IS NULL
             OR details.last_seen_at < job.started_at
           )
         ORDER BY
           CASE WHEN details.source_id IS NULL THEN 0 ELSE 1 END,
           COALESCE(details.last_seen_at, current_list.first_seen_at),
           CAST(current_list.source_id AS INTEGER),
           current_list.source_id
         LIMIT ?`
      )
      .bind(jobId, limit)
      .all<SourceIdRow>();
    return rows.results.map((row) => row.source_id);
  } catch {
    throw syncStoreError();
  }
}

/** Atomare, monotone Fortschrittszaehler eines erfolgreich gespeicherten Batches. */
export async function addInteressentenSyncJobProgress(
  db: D1Database,
  jobId: string,
  input: {
    batchKey: string;
    completedDetails: number;
    created: number;
    errorCount?: number;
    updated: number;
    updatedAt: string;
  }
): Promise<InteressentenSyncJob> {
  validateIdentifier(jobId, 128);
  validateIdentifier(input.batchKey, 128);
  validateIsoTimestamp(input.updatedAt);
  validateCount(input.completedDetails, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.created, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.updated, 0, MAX_INTERESSENTEN_COUNT);
  const errorCount = input.errorCount ?? 0;
  validateCount(errorCount, 0, MAX_INTERESSENTEN_COUNT);
  if (input.created + input.updated > input.completedDetails) {
    throw invalidSyncJobInput();
  }

  try {
    await ensureInteressentenSyncSchema(db);
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO interessenten_sync_progress_batches (
             job_id, batch_key, completed_detail_count,
             created_count, updated_count, error_count, applied, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?, 0, ?
           FROM interessenten_sync_jobs
           WHERE singleton = 1
             AND job_id = ?
             AND status = 'running'`
        )
        .bind(
          jobId,
          input.batchKey,
          input.completedDetails,
          input.created,
          input.updated,
          errorCount,
          input.updatedAt,
          jobId
        ),
      db
        .prepare(
          `UPDATE interessenten_sync_jobs
           SET completed_detail_count = completed_detail_count + ?,
               created_count = created_count + ?,
               updated_count = updated_count + ?,
               error_count = error_count + ?,
               updated_at = ?
           WHERE singleton = 1
             AND job_id = ?
             AND status = 'running'
             AND completed_detail_count + ? <= list_count
             AND EXISTS (
               SELECT 1
               FROM interessenten_sync_progress_batches AS batch
               WHERE batch.job_id = ?
                 AND batch.batch_key = ?
                 AND batch.applied = 0
             )`
        )
        .bind(
          input.completedDetails,
          input.created,
          input.updated,
          errorCount,
          input.updatedAt,
          jobId,
          input.completedDetails,
          jobId,
          input.batchKey
        ),
      db
        .prepare(
          `UPDATE interessenten_sync_progress_batches
           SET applied = 1
           WHERE job_id = ?
             AND batch_key = ?
             AND applied = 0
             AND EXISTS (
               SELECT 1
               FROM interessenten_sync_jobs AS job
               WHERE job.singleton = 1
                 AND job.job_id = ?
                 AND job.completed_detail_count <= job.list_count
             )`
        )
        .bind(jobId, input.batchKey, jobId)
    ]);
    return await requireCurrentJob(db, jobId);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

/** Protokolliert einen wiederholbaren Batchfehler, ohne den Job zu verlieren. */
export async function recordInteressentenSyncJobError(
  db: D1Database,
  jobId: string,
  input: { errorCode: string; errorCount?: number; updatedAt: string }
): Promise<InteressentenSyncJob> {
  validateIdentifier(jobId, 128);
  validateErrorCode(input.errorCode);
  validateIsoTimestamp(input.updatedAt);
  const errorCount = input.errorCount ?? 1;
  validateCount(errorCount, 1, MAX_INTERESSENTEN_COUNT);

  try {
    const result = await db
      .prepare(
        `UPDATE interessenten_sync_jobs
         SET error_count = error_count + ?,
             last_error_code = ?,
             updated_at = ?
         WHERE singleton = 1
           AND job_id = ?
           AND status = 'running'`
      )
      .bind(errorCount, input.errorCode, input.updatedAt, jobId)
      .run();
    requireSingleJobUpdate(result.meta.changes);
    return await requireCurrentJob(db, jobId);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

export async function failInteressentenSyncJob(
  db: D1Database,
  jobId: string,
  input: { errorCode: string; finishedAt: string }
): Promise<InteressentenSyncJob> {
  validateIdentifier(jobId, 128);
  validateErrorCode(input.errorCode);
  validateIsoTimestamp(input.finishedAt);

  try {
    const result = await db
      .prepare(
        `UPDATE interessenten_sync_jobs
         SET status = 'failed',
             finished_at = ?,
             updated_at = ?,
             error_count = error_count + 1,
             last_error_code = ?
         WHERE singleton = 1
           AND job_id = ?
           AND status = 'running'`
      )
      .bind(input.finishedAt, input.finishedAt, input.errorCode, jobId)
      .run();
    requireSingleJobUpdate(result.meta.changes);
    return await requireCurrentJob(db, jobId);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

export async function getInteressentenSyncParity(
  db: D1Database,
  jobId: string
): Promise<InteressentenSyncParity> {
  validateIdentifier(jobId, 128);
  try {
    const row = await buildParityStatement(db, jobId)
      .first<InteressentenSyncParityRow>();
    if (!row) {
      throw syncJobConflict();
    }
    return mapParity(row);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

/**
 * Entfernt ausschliesslich verwaiste Detail-Snapshots und schliesst den Job
 * im selben atomaren Batch nur bei exakter ID- und Aktualitaetsparitaet ab.
 */
export async function finalizeInteressentenSyncJob(
  db: D1Database,
  jobId: string,
  finishedAt: string
): Promise<{
  completed: boolean;
  job: InteressentenSyncJob;
  parity: InteressentenSyncParity;
}> {
  validateIdentifier(jobId, 128);
  validateIsoTimestamp(finishedAt);

  try {
    const listStillMatches = `
      (SELECT COUNT(*) FROM matool_snapshots WHERE area = 'interessenten') = job.list_count
      AND (SELECT COUNT(DISTINCT source_id) FROM matool_snapshots WHERE area = 'interessenten') = job.list_count
      AND NOT EXISTS (
        SELECT 1 FROM matool_snapshots
        WHERE area = 'interessenten'
          AND last_run_id <> job.list_run_id
      )`;
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE interessenten_sync_jobs AS job
           SET stale_detail_removed_count = stale_detail_removed_count + (
                 SELECT COUNT(*)
                 FROM matool_snapshots AS details
                 WHERE details.area = 'interessenten_details'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM matool_snapshots AS current_list
                     WHERE current_list.area = 'interessenten'
                       AND current_list.source_id = details.source_id
                   )
               ),
               updated_at = ?
           WHERE singleton = 1
             AND job_id = ?
             AND status = 'running'
             AND ${listStillMatches}`
        )
        .bind(finishedAt, jobId),
      db
        .prepare(
          `DELETE FROM matool_snapshots AS details
           WHERE details.area = 'interessenten_details'
             AND NOT EXISTS (
               SELECT 1
               FROM matool_snapshots AS current_list
               WHERE current_list.area = 'interessenten'
                 AND current_list.source_id = details.source_id
             )
             AND EXISTS (
               SELECT 1
               FROM interessenten_sync_jobs AS job
               WHERE job.singleton = 1
                 AND job.job_id = ?
                 AND job.status = 'running'
                 AND ${listStillMatches}
             )`
        )
        .bind(jobId),
      db
        .prepare(
          `UPDATE interessenten_sync_jobs AS job
           SET status = 'succeeded',
               finished_at = ?,
               updated_at = ?,
               completed_detail_count = list_count
           WHERE singleton = 1
             AND job_id = ?
             AND status = 'running'
             AND ${listStillMatches}
             AND (
               SELECT COUNT(*)
               FROM matool_snapshots
               WHERE area = 'interessenten_details'
             ) = job.list_count
             AND (
               SELECT COUNT(DISTINCT source_id)
               FROM matool_snapshots
               WHERE area = 'interessenten_details'
             ) = job.list_count
             AND NOT EXISTS (
               SELECT 1
               FROM matool_snapshots AS current_list
               LEFT JOIN matool_snapshots AS details
                 ON details.area = 'interessenten_details'
                AND details.source_id = current_list.source_id
               WHERE current_list.area = 'interessenten'
                 AND (
                   details.source_id IS NULL
                   OR details.last_seen_at < job.started_at
                 )
             )`
        )
        .bind(finishedAt, finishedAt, jobId),
      db.prepare(`${JOB_SELECT_SQL} WHERE singleton = 1 AND job_id = ?`).bind(jobId),
      buildParityStatement(db, jobId)
    ];
    const results = await db.batch<
      InteressentenSyncJobRow | InteressentenSyncParityRow
    >(statements);
    const jobRow = results[3]?.results[0];
    const parityRow = results[4]?.results[0];
    if (!isJobRow(jobRow) || !isParityRow(parityRow)) {
      throw syncJobConflict();
    }
    const job = mapJob(jobRow);
    return {
      completed: job.status === "succeeded",
      job,
      parity: mapParity(parityRow)
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw syncStoreError();
  }
}

const JOB_SELECT_SQL = `SELECT
  job_id, status, started_at, updated_at, finished_at,
  list_digest, list_count, list_run_id,
  initial_list_count, initial_list_unique_count,
  list_created_count, list_updated_count,
  completed_detail_count, created_count, updated_count, error_count,
  stale_list_removed_count, stale_detail_removed_count, last_error_code
FROM interessenten_sync_jobs`;

function buildParityStatement(
  db: D1Database,
  jobId: string
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT
         job.list_count AS expected_list_count,
         (SELECT COUNT(*) FROM matool_snapshots WHERE area = 'interessenten') AS list_count,
         (SELECT COUNT(DISTINCT source_id) FROM matool_snapshots WHERE area = 'interessenten') AS list_unique,
         (SELECT COUNT(*) FROM matool_snapshots WHERE area = 'interessenten_details') AS detail_count,
         (SELECT COUNT(DISTINCT source_id) FROM matool_snapshots WHERE area = 'interessenten_details') AS detail_unique,
         (
           SELECT COUNT(*)
           FROM matool_snapshots AS current_list
           LEFT JOIN matool_snapshots AS details
             ON details.area = 'interessenten_details'
            AND details.source_id = current_list.source_id
           WHERE current_list.area = 'interessenten'
             AND details.source_id IS NULL
         ) AS missing_details,
         (
           SELECT COUNT(*)
           FROM matool_snapshots AS details
           LEFT JOIN matool_snapshots AS current_list
             ON current_list.area = 'interessenten'
            AND current_list.source_id = details.source_id
           WHERE details.area = 'interessenten_details'
             AND current_list.source_id IS NULL
         ) AS extra_details,
         (
           SELECT COUNT(*)
           FROM matool_snapshots AS current_list
           INNER JOIN matool_snapshots AS details
             ON details.area = 'interessenten_details'
            AND details.source_id = current_list.source_id
           WHERE current_list.area = 'interessenten'
             AND details.last_seen_at < job.started_at
         ) AS stale_details,
         (
           SELECT COUNT(*)
           FROM matool_snapshots
           WHERE area = 'interessenten'
             AND last_run_id <> job.list_run_id
         ) AS list_run_mismatch,
         (
           SELECT COUNT(*)
           FROM matool_snapshots
           WHERE area = 'interessenten'
             AND (
               length(source_id) NOT BETWEEN 1 AND 32
               OR source_id GLOB '*[^0-9]*'
             )
         ) AS non_numeric_list_ids
       FROM interessenten_sync_jobs AS job
       WHERE job.singleton = 1
         AND job.job_id = ?`
    )
    .bind(jobId);
}

async function requireCurrentJob(
  db: D1Database,
  jobId: string
): Promise<InteressentenSyncJob> {
  const job = await getCurrentInteressentenSyncJob(db);
  if (!job || job.jobId !== jobId) {
    throw syncJobConflict();
  }
  return job;
}

function mapJob(row: InteressentenSyncJobRow): InteressentenSyncJob {
  return {
    completedDetailCount: requireDbCount(row.completed_detail_count),
    createdCount: requireDbCount(row.created_count),
    errorCount: requireDbCount(row.error_count),
    finishedAt: row.finished_at,
    initialListCount: requireDbCount(row.initial_list_count),
    initialListUniqueCount: requireDbCount(row.initial_list_unique_count),
    jobId: row.job_id,
    lastErrorCode: row.last_error_code,
    listCount: requireDbCount(row.list_count),
    listCreatedCount: requireDbCount(row.list_created_count),
    listDigest: row.list_digest,
    listRunId: row.list_run_id,
    listUpdatedCount: requireDbCount(row.list_updated_count),
    staleDetailRemovedCount: requireDbCount(row.stale_detail_removed_count),
    staleListRemovedCount: requireDbCount(row.stale_list_removed_count),
    startedAt: row.started_at,
    status: row.status,
    updatedAt: row.updated_at,
    updatedCount: requireDbCount(row.updated_count)
  };
}

function mapParity(row: InteressentenSyncParityRow): InteressentenSyncParity {
  return {
    detailCount: requireDbCount(row.detail_count),
    detailUnique: requireDbCount(row.detail_unique),
    expectedListCount: requireDbCount(row.expected_list_count),
    extraDetails: requireDbCount(row.extra_details),
    listCount: requireDbCount(row.list_count),
    listRunMismatch: requireDbCount(row.list_run_mismatch),
    listUnique: requireDbCount(row.list_unique),
    missingDetails: requireDbCount(row.missing_details),
    nonNumericListIds: requireDbCount(row.non_numeric_list_ids),
    staleDetails: requireDbCount(row.stale_details)
  };
}

function matchesStartInput(
  job: InteressentenSyncJob,
  input: StartInteressentenSyncJobInput
): boolean {
  return job.jobId === input.jobId &&
    job.listDigest === input.listDigest &&
    job.listCount === input.listCount &&
    job.listRunId === input.listRunId &&
    job.initialListCount === input.initialListCount &&
    job.initialListUniqueCount === input.initialListUniqueCount &&
    job.listCreatedCount === input.listCreatedCount &&
    job.listUpdatedCount === input.listUpdatedCount &&
    job.staleListRemovedCount === input.staleListRemovedCount &&
    job.startedAt === input.startedAt;
}

function isJobRow(
  row: InteressentenSyncJobRow | InteressentenSyncParityRow | undefined
): row is InteressentenSyncJobRow {
  return row !== undefined && "job_id" in row;
}

function isParityRow(
  row: InteressentenSyncJobRow | InteressentenSyncParityRow | undefined
): row is InteressentenSyncParityRow {
  return row !== undefined && "expected_list_count" in row;
}

function requireSingleJobUpdate(changes: number): void {
  if (changes !== 1) {
    throw syncJobConflict();
  }
}

function validateStartInput(input: StartInteressentenSyncJobInput): void {
  validateIdentifier(input.jobId, 128);
  validateIdentifier(input.listRunId, 128);
  validateIsoTimestamp(input.startedAt);
  if (!/^[0-9a-f]{64}$/u.test(input.listDigest)) {
    throw invalidSyncJobInput();
  }
  validateCount(input.listCount, 1, MAX_INTERESSENTEN_COUNT);
  validateCount(input.initialListCount, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.initialListUniqueCount, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.listCreatedCount, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.listUpdatedCount, 0, MAX_INTERESSENTEN_COUNT);
  validateCount(input.staleListRemovedCount, 0, MAX_INTERESSENTEN_COUNT);
  if (
    input.initialListUniqueCount > input.initialListCount ||
    input.listCreatedCount + input.listUpdatedCount > input.listCount
  ) {
    throw invalidSyncJobInput();
  }
}

function validateCount(value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidSyncJobInput();
  }
}

function validateIdentifier(value: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  ) {
    throw invalidSyncJobInput();
  }
}

function validateErrorCode(value: string): void {
  validateIdentifier(value, 96);
}

function validateIsoTimestamp(value: string): void {
  if (value.length > 40) {
    throw invalidSyncJobInput();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw invalidSyncJobInput();
  }
}

function requireDbCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw syncStoreError();
  }
  return value;
}

function invalidSyncJobInput(): AppError {
  return new AppError(
    "invalid_interessenten_sync_job",
    500,
    "Der Interessenten-Abgleich enthaelt ungueltige Zustandsdaten."
  );
}

function syncJobConflict(): AppError {
  return new AppError(
    "interessenten_sync_job_conflict",
    409,
    "Der Interessenten-Abgleich ist nicht der aktive fortsetzbare Job."
  );
}

function syncStoreError(): AppError {
  return new AppError(
    "interessenten_sync_store_unavailable",
    503,
    "Der Zustand des Interessenten-Abgleichs konnte nicht verarbeitet werden."
  );
}
