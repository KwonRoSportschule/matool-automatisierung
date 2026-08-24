import { AppError } from "../core/app-error";
import {
  persistMatoolSnapshotRun,
  type MatoolSnapshotRecord,
  type MatoolSnapshotRunResult,
  type PersistMatoolSnapshotRunInput
} from "./matool-store";

const LEASE_NAME = "direct_snapshots";
export const EXACT_SYNC_LEASE_MS = 20 * 60 * 1_000;
const MIN_BASELINE_COUNT_FOR_SHRINK_GUARD = 10;
const MIN_ACCEPTED_BASELINE_PERCENT = 80;

interface ExactSyncLeaseRow {
  expires_at: string;
  fencing_token: number;
  owner_id: string;
}

interface ExactSourceBaselineRow {
  success_count: number;
}

export interface ExactSyncLease {
  expiresAt: string;
  fencingToken: number;
  ownerId: string;
}

export interface ExactSourceSession {
  clear(): void;
  read(): Promise<readonly MatoolSnapshotRecord[]>;
}

/**
 * Deployment-sichere, idempotente Schema-Anlage. Der GitHub-Deploy allein
 * wendet D1-Migrationen nicht an; deshalb muss der erste Lauf fail-closed
 * selbst fuer die Lease-Tabellen sorgen koennen.
 */
export async function ensureExactSyncSafetySchema(
  db: D1Database
): Promise<void> {
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS matool_exact_sync_leases (
        lease_name TEXT PRIMARY KEY CHECK (lease_name = 'direct_snapshots'),
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS matool_exact_sync_fence_checks (
        lease_name TEXT PRIMARY KEY CHECK (lease_name = 'direct_snapshots'),
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
        checked_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS matool_exact_sync_fence_check_insert
        BEFORE INSERT ON matool_exact_sync_fence_checks
        WHEN NOT EXISTS (
          SELECT 1
          FROM matool_exact_sync_leases
          WHERE lease_name = NEW.lease_name
            AND owner_id = NEW.owner_id
            AND fencing_token = NEW.fencing_token
            AND expires_at > NEW.checked_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'matool_exact_sync_lease_lost');
        END`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS matool_exact_sync_fence_check_update
        BEFORE UPDATE ON matool_exact_sync_fence_checks
        WHEN NOT EXISTS (
          SELECT 1
          FROM matool_exact_sync_leases
          WHERE lease_name = NEW.lease_name
            AND owner_id = NEW.owner_id
            AND fencing_token = NEW.fencing_token
            AND expires_at > NEW.checked_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'matool_exact_sync_lease_lost');
        END`)
    ]);
  } catch {
    throw exactSyncLeaseStoreError();
  }
}

/**
 * Uebernimmt die globale Direktlauf-Lease atomar. Eine abgelaufene Lease ist
 * uebernehmbar; jede Uebernahme erhoeht den Fencing-Token monoton.
 */
export async function acquireExactSyncLease(
  db: D1Database,
  ownerId: string,
  now: Date = new Date(),
  leaseMs: number = EXACT_SYNC_LEASE_MS
): Promise<ExactSyncLease> {
  validateOwnerId(ownerId);
  const nowIso = timestamp(now);
  const expiresAt = expiration(now, leaseMs);
  await ensureExactSyncSafetySchema(db);

  try {
    const row = await db
      .prepare(
        `INSERT INTO matool_exact_sync_leases (
           lease_name, owner_id, fencing_token,
           acquired_at, heartbeat_at, expires_at
         ) VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT (lease_name) DO UPDATE SET
           owner_id = excluded.owner_id,
           fencing_token = matool_exact_sync_leases.fencing_token + 1,
           acquired_at = excluded.acquired_at,
           heartbeat_at = excluded.heartbeat_at,
           expires_at = excluded.expires_at
         WHERE matool_exact_sync_leases.owner_id = excluded.owner_id
            OR matool_exact_sync_leases.expires_at <= ?
         RETURNING owner_id, fencing_token, expires_at`
      )
      .bind(
        LEASE_NAME,
        ownerId,
        nowIso,
        nowIso,
        expiresAt,
        nowIso
      )
      .first<ExactSyncLeaseRow>();
    if (!row || row.owner_id !== ownerId) {
      throw exactSyncBusyError();
    }
    return exactSyncLease(row);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw exactSyncLeaseStoreError();
  }
}

/** Verlaengert nur eine noch aktive, exakt passende Lease. */
export async function renewExactSyncLease(
  db: D1Database,
  lease: ExactSyncLease,
  now: Date = new Date(),
  leaseMs: number = EXACT_SYNC_LEASE_MS
): Promise<ExactSyncLease> {
  validateLease(lease);
  const nowIso = timestamp(now);
  const expiresAt = expiration(now, leaseMs);
  try {
    const row = await db
      .prepare(
        `UPDATE matool_exact_sync_leases
         SET heartbeat_at = ?, expires_at = ?
         WHERE lease_name = ?
           AND owner_id = ?
           AND fencing_token = ?
           AND expires_at > ?
         RETURNING owner_id, fencing_token, expires_at`
      )
      .bind(
        nowIso,
        expiresAt,
        LEASE_NAME,
        lease.ownerId,
        lease.fencingToken,
        nowIso
      )
      .first<ExactSyncLeaseRow>();
    if (!row) {
      throw exactSyncLeaseLostError();
    }
    return exactSyncLease(row);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw exactSyncLeaseStoreError();
  }
}

/** Gibt niemals eine inzwischen von einem anderen Lauf gehaltene Lease frei. */
export async function releaseExactSyncLease(
  db: D1Database,
  lease: ExactSyncLease
): Promise<boolean> {
  validateLease(lease);
  try {
    const result = await db
      .prepare(
        `DELETE FROM matool_exact_sync_leases
         WHERE lease_name = ?
           AND owner_id = ?
           AND fencing_token = ?`
      )
      .bind(LEASE_NAME, lease.ownerId, lease.fencingToken)
      .run();
    return result.meta.changes === 1;
  } catch {
    throw exactSyncLeaseStoreError();
  }
}

/**
 * Liest einen exakten Bereich zweimal ueber zwei unabhaengige Sessions. Nur
 * identische Reihenfolge, IDs und kanonische Payloads werden freigegeben.
 */
export async function readMatchingExactSource(
  createSession: () => ExactSourceSession,
  betweenReads: () => Promise<void> = async () => {}
): Promise<readonly MatoolSnapshotRecord[]> {
  const firstSession = createSession();
  let first: readonly MatoolSnapshotRecord[];
  try {
    first = await firstSession.read();
  } finally {
    firstSession.clear();
  }

  await betweenReads();

  const secondSession = createSession();
  let second: readonly MatoolSnapshotRecord[];
  try {
    second = await secondSession.read();
  } finally {
    secondSession.clear();
  }

  assertMatchingExactSource(first, second);
  return first;
}

export function assertMatchingExactSource(
  first: readonly MatoolSnapshotRecord[],
  second: readonly MatoolSnapshotRecord[]
): void {
  if (first.length === 0 || first.length !== second.length) {
    throw exactSourceMismatchError();
  }
  for (let index = 0; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (
      !left ||
      !right ||
      left.sourceId !== right.sourceId ||
      canonicalRecord(left) !== canonicalRecord(right)
    ) {
      throw exactSourceMismatchError();
    }
  }
}

/**
 * Verhindert, dass zwei identische, aber offensichtlich verkuerzte
 * Quellantworten einen zuletzt erfolgreichen Bestand zerstoeren. Als
 * Vergleich dient bewusst der letzte erfolgreiche Collector-Zaehler und
 * nicht die historische Snapshot-Gesamtmenge.
 */
export async function assertExactSourceBaseline(
  db: D1Database,
  area: string,
  sourceCount: number
): Promise<void> {
  if (
    !/^[a-z][a-z0-9_]{0,63}$/u.test(area) ||
    !Number.isSafeInteger(sourceCount) ||
    sourceCount < 1
  ) {
    throw exactSourceBaselineError();
  }
  let row: ExactSourceBaselineRow | null;
  try {
    row = await db
      .prepare(
        `SELECT success_count
         FROM matool_snapshot_runs
         WHERE area = ?
           AND status = 'succeeded'
           AND failure_count = 0
           AND error_code IS NULL
         ORDER BY finished_at DESC, started_at DESC
         LIMIT 1`
      )
      .bind(area)
      .first<ExactSourceBaselineRow>();
  } catch {
    throw exactSyncLeaseStoreError();
  }
  if (!row) {
    return;
  }
  const baseline = row.success_count;
  if (!Number.isSafeInteger(baseline) || baseline < 0) {
    throw exactSyncLeaseStoreError();
  }
  if (
    baseline >= MIN_BASELINE_COUNT_FOR_SHRINK_GUARD &&
    sourceCount * 100 < baseline * MIN_ACCEPTED_BASELINE_PERCENT
  ) {
    throw exactSourceBaselineError();
  }
}

/**
 * Der Store bleibt unveraendert; sein kompletter atomarer D1-Batch wird um
 * einen Lease-Guard erweitert. Scheitert der Guard, rollt D1 laut Batch-
 * Semantik auch alle folgenden Upserts und Loeschungen zurueck.
 */
export function persistFencedExactSnapshotRun(
  db: D1Database,
  lease: ExactSyncLease,
  input: PersistMatoolSnapshotRunInput
): Promise<MatoolSnapshotRunResult> {
  validateLease(lease);
  return persistMatoolSnapshotRun(fencedDatabase(db, lease), input);
}

function fencedDatabase(
  db: D1Database,
  lease: ExactSyncLease
): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async <T = unknown>(
          statements: D1PreparedStatement[]
        ): Promise<D1Result<T>[]> => {
          const checkedAt = new Date().toISOString();
          const guard = target
            .prepare(
              `INSERT INTO matool_exact_sync_fence_checks (
                 lease_name, owner_id, fencing_token, checked_at
               ) VALUES (?, ?, ?, ?)
               ON CONFLICT (lease_name) DO UPDATE SET
                 owner_id = excluded.owner_id,
                 fencing_token = excluded.fencing_token,
                 checked_at = excluded.checked_at`
            )
            .bind(
              LEASE_NAME,
              lease.ownerId,
              lease.fencingToken,
              checkedAt
            );
          const results = await target.batch<T>([guard, ...statements]);
          return results.slice(1);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function canonicalRecord(record: MatoolSnapshotRecord): string {
  const payload = Object.fromEntries(
    Object.entries(record.payload).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
  return JSON.stringify([record.sourceId, payload]);
}

function exactSyncLease(row: ExactSyncLeaseRow): ExactSyncLease {
  if (
    !Number.isSafeInteger(row.fencing_token) ||
    row.fencing_token < 1 ||
    !Number.isFinite(Date.parse(row.expires_at))
  ) {
    throw exactSyncLeaseStoreError();
  }
  validateOwnerId(row.owner_id);
  return {
    expiresAt: row.expires_at,
    fencingToken: row.fencing_token,
    ownerId: row.owner_id
  };
}

function validateLease(lease: ExactSyncLease): void {
  validateOwnerId(lease.ownerId);
  if (
    !Number.isSafeInteger(lease.fencingToken) ||
    lease.fencingToken < 1 ||
    !Number.isFinite(Date.parse(lease.expiresAt))
  ) {
    throw exactSyncLeaseStoreError();
  }
}

function validateOwnerId(ownerId: string): void {
  if (
    ownerId.length === 0 ||
    ownerId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(ownerId)
  ) {
    throw exactSyncLeaseStoreError();
  }
}

function timestamp(value: Date): string {
  const epoch = value.getTime();
  if (!Number.isFinite(epoch)) {
    throw exactSyncLeaseStoreError();
  }
  return value.toISOString();
}

function expiration(now: Date, leaseMs: number): string {
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1 ||
    leaseMs > 60 * 60 * 1_000
  ) {
    throw exactSyncLeaseStoreError();
  }
  return new Date(now.getTime() + leaseMs).toISOString();
}

function exactSyncBusyError(): AppError {
  return new AppError(
    "matool_exact_sync_busy",
    409,
    "Ein anderer direkter MATOOL-Abgleich laeuft bereits."
  );
}

function exactSyncLeaseLostError(): AppError {
  return new AppError(
    "matool_exact_sync_lease_lost",
    503,
    "Die Lease des direkten MATOOL-Abgleichs ist nicht mehr gueltig."
  );
}

function exactSyncLeaseStoreError(): AppError {
  return new AppError(
    "matool_exact_sync_lease_store_failed",
    503,
    "Die Lease des direkten MATOOL-Abgleichs konnte nicht sicher gespeichert werden."
  );
}

function exactSourceMismatchError(): AppError {
  return new AppError(
    "matool_exact_source_mismatch",
    503,
    "Zwei vollstaendige MATOOL-Abrufe waren nicht exakt identisch."
  );
}

function exactSourceBaselineError(): AppError {
  return new AppError(
    "matool_exact_source_implausible_shrink",
    503,
    "Der vollstaendige MATOOL-Abruf ist gegenueber dem letzten Erfolg unplausibel stark verkleinert."
  );
}
