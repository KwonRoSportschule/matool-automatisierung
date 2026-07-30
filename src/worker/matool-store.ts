import { AppError } from "../core/app-error";

const MAX_RECORDS_PER_RUN = 20_000;
const MAX_PAYLOAD_FIELDS = 80;
const MAX_PAYLOAD_BYTES = 16_384;
const MAX_PAYLOAD_STRING_LENGTH = 2_000;
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
  runId: string;
  startedAt: string;
}

export interface RecordMatoolSnapshotFailureInput {
  area: string;
  errorCode: string;
  failureCount?: number;
  fetchedCount?: number;
  finishedAt: string;
  runId: string;
  startedAt: string;
}

export async function persistMatoolSnapshotRun(
  db: D1Database,
  input: PersistMatoolSnapshotRunInput
): Promise<{ storedCount: number }> {
  validateRunIdentity(input);
  validateTimestamp(input.observedAt);
  if (input.records.length > MAX_RECORDS_PER_RUN) {
    throw invalidSnapshotInput();
  }

  const allowedFields = validateAllowedFields(input.allowedPayloadFields);
  const sourceIds = new Set<string>();
  const snapshots: Array<{
    contentHash: string;
    payloadJson: string;
    sourceId: string;
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
      sourceId: record.sourceId
    });
  }

  const runStatement = db
    .prepare(
      `INSERT INTO matool_snapshot_runs (
         run_id, area, status, started_at, finished_at,
         fetched_count, success_count, failure_count, error_code
       ) VALUES (?, ?, 'succeeded', ?, ?, ?, ?, 0, NULL)`
    )
    .bind(
      input.runId,
      input.area,
      input.startedAt,
      input.finishedAt,
      snapshots.length,
      snapshots.length
    );

  // Große Bereiche wie schueler überschreiten eine einzelne D1-Anweisung.
  // Die Snapshots werden deshalb in Blöcke unterhalb des Limits zerlegt.
  const chunks = chunkSnapshots(snapshots);

  try {
    const firstChunk = chunks[0];
    await db.batch(
      firstChunk
        ? [runStatement, buildSnapshotStatement(db, input, firstChunk)]
        : [runStatement]
    );
    for (const chunk of chunks.slice(1)) {
      await db.batch([buildSnapshotStatement(db, input, chunk)]);
    }
  } catch {
    throw snapshotPersistenceError();
  }
  return { storedCount: snapshots.length };
}

interface PreparedSnapshot {
  contentHash: string;
  payloadJson: string;
  sourceId: string;
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
         content_hash, payload_json, last_run_id
       )
       SELECT
         ?, json_extract(value, '$.sourceId'), ?, ?,
         json_extract(value, '$.contentHash'),
         json_extract(value, '$.payloadJson'), ?
       FROM json_each(?)
       WHERE json_type(value) = 'object'
       ON CONFLICT (area, source_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         content_hash = excluded.content_hash,
         payload_json = excluded.payload_json,
         last_run_id = excluded.last_run_id`
    )
    .bind(
      input.area,
      input.observedAt,
      input.observedAt,
      input.runId,
      JSON.stringify(chunk)
    );
}

export async function recordMatoolSnapshotFailure(
  db: D1Database,
  input: RecordMatoolSnapshotFailureInput
): Promise<void> {
  validateRunIdentity(input);
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
           fetched_count, success_count, failure_count, error_code
         ) VALUES (?, ?, 'failed', ?, ?, ?, 0, ?, ?)`
      )
      .bind(
        input.runId,
        input.area,
        input.startedAt,
        input.finishedAt,
        fetchedCount,
        failureCount,
        input.errorCode
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
