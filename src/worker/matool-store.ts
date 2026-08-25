import { AppError } from "../core/app-error";
import { ensureInteressentenSyncSchema } from "./interessenten-sync-store";

const MAX_RECORDS_PER_RUN = 20_000;
const EXACT_CURRENT_SET_AREAS = new Set([
  "archiv",
  "artikel",
  "interessenten",
  "klassen",
  "lager",
  "newsletter",
  "schueler"
]);
const MAX_PAYLOAD_FIELDS = 80;
// Schuelerdetails enthalten 67 Felder sowie vollstaendige Listenwerte. Das
// alte 16-KiB-Limit verwarf gueltige, vollstaendig gelesene Datensaetze erst
// beim Persistieren. Die Grenzen bleiben bewusst unter dem D1-Zeilenlimit und
// unterhalb des Statement-Budgets, erlauben aber die bestaetigten Details.
const MAX_PAYLOAD_BYTES = 512_000;
const MAX_PAYLOAD_STRING_LENGTH = 256_000;
const MAX_SNAPSHOT_BATCH_BYTES = 1_800_000;

export type MatoolSnapshotValue = boolean | number | string | null;

export interface MatoolSnapshotRecord {
  sourceId: string;
  payload: Readonly<Record<string, MatoolSnapshotValue>>;
}

export interface PersistMatoolSnapshotRunInput {
  allowedPayloadFields: readonly string[];
  area: string;
  finishedAt: string;
  observedAt: string;
  records: readonly MatoolSnapshotRecord[];
  /**
   * Ersetzt den aktuellen Bestand eines statisch freigegebenen Listenbereichs
   * exakt durch diesen vollstaendigen Lauf. Veraltete Zeilen werden im selben
   * atomaren D1-Batch wie die Upserts geloescht.
   */
  replaceCurrentSet?: boolean;
  runId: string;
  syncId?: string;
  startedAt: string;
}

export interface MatoolSnapshotRunResult {
  createdCount: number;
  staleRemovedCount: number;
  storedCount: number;
  updatedCount: number;
}

export interface RecordMatoolSnapshotFailureInput {
  area: string;
  errorCode: string;
  failureCount?: number;
  fetchedCount?: number;
  finishedAt: string;
  runId: string;
  syncId?: string;
  startedAt: string;
}

export async function persistMatoolSnapshotRun(
  db: D1Database,
  input: PersistMatoolSnapshotRunInput
): Promise<MatoolSnapshotRunResult> {
  validateRunIdentity(input);
  if (input.syncId) {
    validateIdentifier(input.syncId, 128);
  }
  validateTimestamp(input.observedAt);
  if (input.records.length > MAX_RECORDS_PER_RUN) {
    throw invalidSnapshotInput();
  }
  if (
    input.replaceCurrentSet === true &&
    (!EXACT_CURRENT_SET_AREAS.has(input.area) || input.records.length === 0)
  ) {
    throw invalidSnapshotInput();
  }

  const allowedFields = validateAllowedFields(input.allowedPayloadFields);
  const sourceIds = new Set<string>();
  const snapshots: Array<{
    contentHash: string;
    payloadJson: string;
    sourceId: string;
    zapierEventId: string;
  }> = [];
  for (const record of input.records) {
    validateIdentifier(record.sourceId, 128);
    if (sourceIds.has(record.sourceId)) {
      throw invalidSnapshotInput();
    }
    sourceIds.add(record.sourceId);
    const payloadJson = canonicalizeAllowedPayload(
      record.payload,
      allowedFields
    );
    snapshots.push({
      contentHash: await sha256Hex(payloadJson),
      payloadJson,
      sourceId: record.sourceId,
      zapierEventId: await sha256Hex(
        JSON.stringify([input.area, record.sourceId, input.runId])
      )
    });
  }

  // Große Bereiche wie schueler überschreiten eine einzelne D1-Anweisung.
  // Die Snapshots werden deshalb in Blöcke unterhalb des Limits zerlegt.
  const chunks = chunkSnapshots(snapshots);

  if (input.replaceCurrentSet === true) {
    await ensureInteressentenSyncSchema(db);
    const existing = await readIdempotentCompleteListResult(
      db,
      input,
      chunks
    );
    if (existing) {
      return existing;
    }
  }

  const runStatement = db
    .prepare(
      `INSERT INTO matool_snapshot_runs (
         run_id, area, status, started_at, finished_at,
         fetched_count, success_count, failure_count, error_code, sync_id
       ) VALUES (?, ?, 'succeeded', ?, ?, ?, ?, 0, NULL, ?)`
    )
    .bind(
      input.runId,
      input.area,
      input.startedAt,
      input.finishedAt,
      snapshots.length,
      snapshots.length,
      input.syncId ?? null
    );

  try {
    // D1 fuehrt ein batch atomar und in Reihenfolge aus. Jeder Change-SELECT
    // muss dabei den vorherigen Snapshot sehen; erst danach folgt der Upsert.
    // Ein einziger Batch verhindert zudem Teilstaende, falls ein spaeterer
    // Datenblock scheitert.
    const statements: D1PreparedStatement[] = [runStatement];
    for (const chunk of chunks) {
      statements.push(
        buildSnapshotChangeStatement(db, input, chunk),
        buildSnapshotStatement(db, input, chunk)
      );
    }
    if (input.replaceCurrentSet === true) {
      statements.push(
        db
          .prepare(
            `INSERT INTO matool_snapshot_run_results (
               run_id, created_count, updated_count, stale_removed_count
             )
             SELECT
               ?,
               COUNT(*) FILTER (WHERE change_kind = 'created'),
               COUNT(*) FILTER (WHERE change_kind = 'updated'),
               (
                 SELECT COUNT(*)
                 FROM matool_snapshots
                 WHERE area = ?
                   AND last_run_id <> ?
               )
             FROM matool_snapshot_changes
             WHERE run_id = ?`
          )
          .bind(input.runId, input.area, input.runId, input.runId),
        db
          .prepare(
            `DELETE FROM matool_snapshots
             WHERE area = ?
               AND last_run_id <> ?`
          )
          .bind(input.area, input.runId)
      );
    }
    const changeCountsIndex = statements.push(
      input.replaceCurrentSet === true
        ? db
            .prepare(
              `SELECT created_count, updated_count, stale_removed_count
               FROM matool_snapshot_run_results
               WHERE run_id = ?`
            )
            .bind(input.runId)
        : db
            .prepare(
              `SELECT
                 COUNT(*) FILTER (WHERE change_kind = 'created') AS created_count,
                 COUNT(*) FILTER (WHERE change_kind = 'updated') AS updated_count,
                 0 AS stale_removed_count
               FROM matool_snapshot_changes
               WHERE run_id = ?`
            )
            .bind(input.runId)
    ) - 1;
    const results = await db.batch<SnapshotChangeCountsRow>(statements);
    const changeCounts = results[changeCountsIndex]?.results[0];
    if (!changeCounts) {
      throw snapshotPersistenceError();
    }
    return {
      createdCount: requireStoredCount(changeCounts.created_count),
      staleRemovedCount: requireStoredCount(
        changeCounts.stale_removed_count
      ),
      storedCount: snapshots.length,
      updatedCount: requireStoredCount(changeCounts.updated_count)
    };
  } catch {
    throw snapshotPersistenceError();
  }
}

interface SnapshotChangeCountsRow {
  created_count: number;
  stale_removed_count: number;
  updated_count: number;
}

function requireStoredCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw snapshotPersistenceError();
  }
  return value;
}

interface PreparedSnapshot {
  contentHash: string;
  payloadJson: string;
  sourceId: string;
  zapierEventId: string;
}

interface ExistingCompleteListRow extends SnapshotChangeCountsRow {
  area: string;
  current_count: number;
  current_run_count: number;
  fetched_count: number;
  status: string;
  success_count: number;
}

interface MatchingSnapshotCountRow {
  matching_count: number;
}

async function readIdempotentCompleteListResult(
  db: D1Database,
  input: PersistMatoolSnapshotRunInput,
  chunks: readonly (readonly PreparedSnapshot[])[]
): Promise<MatoolSnapshotRunResult | null> {
  try {
    const existing = await db
      .prepare(
        `SELECT
           runs.area,
           runs.status,
           runs.fetched_count,
           runs.success_count,
           results.created_count,
           results.updated_count,
           results.stale_removed_count,
           (
             SELECT COUNT(*)
             FROM matool_snapshots
             WHERE area = ?
           ) AS current_count,
           (
             SELECT COUNT(*)
             FROM matool_snapshots
             WHERE area = ?
               AND last_run_id = ?
           ) AS current_run_count
         FROM matool_snapshot_run_results AS results
         INNER JOIN matool_snapshot_runs AS runs
           ON runs.run_id = results.run_id
         WHERE results.run_id = ?`
      )
      .bind(input.area, input.area, input.runId, input.runId)
      .first<ExistingCompleteListRow>();
    if (!existing) {
      return null;
    }

    const expectedCount = input.records.length;
    if (
      existing.area !== input.area ||
      existing.status !== "succeeded" ||
      requireStoredCount(existing.fetched_count) !== expectedCount ||
      requireStoredCount(existing.success_count) !== expectedCount ||
      requireStoredCount(existing.current_count) !== expectedCount ||
      requireStoredCount(existing.current_run_count) !== expectedCount
    ) {
      throw snapshotPersistenceError();
    }

    const matches = await db.batch<MatchingSnapshotCountRow>(
      chunks.map((chunk) =>
        db
          .prepare(
            `SELECT COUNT(*) AS matching_count
             FROM json_each(?) AS incoming
             INNER JOIN matool_snapshots AS stored
               ON stored.area = ?
              AND stored.source_id = json_extract(incoming.value, '$.sourceId')
              AND stored.content_hash = json_extract(incoming.value, '$.contentHash')
              AND stored.last_run_id = ?
             WHERE json_type(incoming.value) = 'object'`
          )
          .bind(JSON.stringify(chunk), input.area, input.runId)
      )
    );
    const matchingCount = matches.reduce(
      (total, result) =>
        total + requireStoredCount(result.results[0]?.matching_count),
      0
    );
    if (matchingCount !== expectedCount) {
      throw snapshotPersistenceError();
    }

    return {
      createdCount: requireStoredCount(existing.created_count),
      staleRemovedCount: requireStoredCount(existing.stale_removed_count),
      storedCount: expectedCount,
      updatedCount: requireStoredCount(existing.updated_count)
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw snapshotPersistenceError();
  }
}

function chunkSnapshots(
  snapshots: readonly PreparedSnapshot[]
): PreparedSnapshot[][] {
  const encoder = new TextEncoder();
  const chunks: PreparedSnapshot[][] = [];
  let current: PreparedSnapshot[] = [];
  let currentBytes = 2;

  for (const snapshot of snapshots) {
    const size = encoder.encode(JSON.stringify(snapshot)).byteLength + 1;
    if (current.length > 0 && currentBytes + size > MAX_SNAPSHOT_BATCH_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(snapshot);
    currentBytes += size;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function buildSnapshotStatement(
  db: D1Database,
  input: PersistMatoolSnapshotRunInput,
  chunk: readonly PreparedSnapshot[]
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO matool_snapshots (
         area, source_id, first_seen_at, last_seen_at,
         content_hash, payload_json, last_run_id, public_id, last_changed_at
       )
       SELECT
         ?, json_extract(value, '$.sourceId'), ?, ?,
         json_extract(value, '$.contentHash'),
         json_extract(value, '$.payloadJson'), ?, lower(hex(randomblob(16))), ?
       FROM json_each(?)
       WHERE json_type(value) = 'object'
       ON CONFLICT (area, source_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         last_changed_at = CASE
           WHEN matool_snapshots.content_hash <> excluded.content_hash
             THEN excluded.last_changed_at
           ELSE matool_snapshots.last_changed_at
         END,
         content_hash = excluded.content_hash,
         payload_json = excluded.payload_json,
         last_run_id = excluded.last_run_id`
    )
    .bind(
      input.area,
      input.observedAt,
      input.observedAt,
      input.runId,
      input.observedAt,
      JSON.stringify(chunk)
    );
}

function buildSnapshotChangeStatement(
  db: D1Database,
  input: PersistMatoolSnapshotRunInput,
  chunk: readonly PreparedSnapshot[]
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO matool_snapshot_changes (
         area, source_id, run_id, change_kind, observed_at, content_hash,
         payload_json, zapier_event_id
       )
       SELECT
         ?,
         json_extract(incoming.value, '$.sourceId'),
         ?,
         CASE
           WHEN existing.source_id IS NULL THEN 'created'
           ELSE 'updated'
         END,
         ?,
         json_extract(incoming.value, '$.contentHash'),
         json_extract(incoming.value, '$.payloadJson'),
         json_extract(incoming.value, '$.zapierEventId')
       FROM json_each(?) AS incoming
       LEFT JOIN matool_snapshots AS existing
         ON existing.area = ?
        AND existing.source_id = json_extract(incoming.value, '$.sourceId')
       WHERE json_type(incoming.value) = 'object'
         AND (
           existing.source_id IS NULL
           OR existing.content_hash <> json_extract(incoming.value, '$.contentHash')
         )
       ON CONFLICT (area, source_id, run_id) DO NOTHING`
    )
    .bind(
      input.area,
      input.runId,
      input.observedAt,
      JSON.stringify(chunk),
      input.area
    );
}

export async function recordMatoolSnapshotFailure(
  db: D1Database,
  input: RecordMatoolSnapshotFailureInput
): Promise<void> {
  validateRunIdentity(input);
  if (input.syncId) {
    validateIdentifier(input.syncId, 128);
  }
  validateCode(input.errorCode);
  const fetchedCount = input.fetchedCount ?? 0;
  const failureCount = input.failureCount ?? 1;
  if (
    !Number.isSafeInteger(fetchedCount) ||
    fetchedCount < 0 ||
    !Number.isSafeInteger(failureCount) ||
    failureCount < 1
  ) {
    throw invalidSnapshotInput();
  }

  try {
    await db
      .prepare(
        `INSERT INTO matool_snapshot_runs (
           run_id, area, status, started_at, finished_at,
           fetched_count, success_count, failure_count, error_code, sync_id
         ) VALUES (?, ?, 'failed', ?, ?, ?, 0, ?, ?, ?)`
      )
      .bind(
        input.runId,
        input.area,
        input.startedAt,
        input.finishedAt,
        fetchedCount,
        failureCount,
        input.errorCode,
        input.syncId ?? null
      )
      .run();
  } catch {
    throw snapshotPersistenceError();
  }
}

function validateRunIdentity(input: {
  area: string;
  finishedAt: string;
  runId: string;
  startedAt: string;
}): void {
  validateIdentifier(input.area, 64);
  validateIdentifier(input.runId, 128);
  const startedAt = validateTimestamp(input.startedAt);
  const finishedAt = validateTimestamp(input.finishedAt);
  if (finishedAt < startedAt) {
    throw invalidSnapshotInput();
  }
}

function validateAllowedFields(fields: readonly string[]): Set<string> {
  if (fields.length === 0 || fields.length > MAX_PAYLOAD_FIELDS) {
    throw invalidSnapshotInput();
  }
  const allowed = new Set<string>();
  for (const field of fields) {
    validateIdentifier(field, 64);
    if (allowed.has(field)) {
      throw invalidSnapshotInput();
    }
    allowed.add(field);
  }
  return allowed;
}

function canonicalizeAllowedPayload(
  payload: Readonly<Record<string, MatoolSnapshotValue>>,
  allowedFields: ReadonlySet<string>
): string {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw invalidSnapshotInput();
  }
  const keys = Object.keys(payload).sort();
  if (
    keys.length === 0 ||
    keys.length > MAX_PAYLOAD_FIELDS ||
    keys.some((key) => !allowedFields.has(key))
  ) {
    throw invalidSnapshotInput();
  }

  const canonical: Record<string, MatoolSnapshotValue> = {};
  for (const key of keys) {
    const value = payload[key];
    if (
      value === undefined ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" &&
        value.length > MAX_PAYLOAD_STRING_LENGTH) ||
      (value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean")
    ) {
      throw invalidSnapshotInput();
    }
    canonical[key] = value;
  }

  const payloadJson = JSON.stringify(canonical);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
    throw invalidSnapshotInput();
  }
  return payloadJson;
}

function validateIdentifier(value: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  ) {
    throw invalidSnapshotInput();
  }
}

function validateCode(value: string): void {
  validateIdentifier(value, 96);
}

function validateTimestamp(value: string): number {
  if (value.length > 40) {
    throw invalidSnapshotInput();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw invalidSnapshotInput();
  }
  return timestamp;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function invalidSnapshotInput(): AppError {
  return new AppError(
    "invalid_matool_snapshot",
    500,
    "Der MATOOL-Snapshot entspricht nicht dem freigegebenen Schema."
  );
}

function snapshotPersistenceError(): AppError {
  return new AppError(
    "matool_snapshot_persistence_failed",
    503,
    "Der MATOOL-Snapshot konnte nicht atomar gespeichert werden."
  );
}
