import { AppError } from "../core/app-error";

interface SnapshotSubscriptionRow {
  subscription_id: string;
}

interface SnapshotDeliveryLeaseRow {
  area: string;
  attempt_count: number;
  change_id: number;
  change_kind: "created" | "updated";
  content_hash: string;
  event_id: string;
  first_seen_at: string;
  last_seen_at: string;
  observed_at: string;
  payload_json: string;
  run_id: string;
  source_id: string;
  subscription_id: string;
  target_url: string;
}

export interface CreateSnapshotZapierSubscriptionInput {
  area: string;
  onlyChanged: boolean;
  targetUrl: string;
}

export interface SnapshotZapierDeliveryLease {
  area: string;
  attemptNumber: number;
  changeId: number;
  changeKind: "created" | "updated";
  contentHash: string;
  deliveryId: string;
  eventId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  leaseOwner: string;
  observedAt: string;
  payloadJson: string;
  runId: string;
  sourceId: string;
  startedAt: string;
  subscriptionId: string;
  targetUrl: string;
}

export async function createSnapshotZapierSubscription(
  db: D1Database,
  input: CreateSnapshotZapierSubscriptionInput,
  now: Date
): Promise<{ id: string }> {
  validateArea(input.area);
  validateTargetUrl(input.targetUrl);
  const timestamp = validateDate(now);
  const subscriptionId = `zsnap_${crypto.randomUUID()}`;
  const row = await db
    .prepare(
      `INSERT INTO zapier_snapshot_subscriptions (
         subscription_id,
         target_url,
         area,
         only_changed,
         status,
         last_delivered_change_id,
         created_at,
         updated_at
       )
       VALUES (
         ?, ?, ?, ?, 'active',
         COALESCE((
           SELECT MAX(change_id)
           FROM matool_snapshot_changes
           WHERE area = ?
         ), 0),
         ?, ?
       )
       ON CONFLICT(target_url) DO UPDATE SET
         area = excluded.area,
         only_changed = excluded.only_changed,
         status = 'active',
         last_delivered_change_id = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.last_delivered_change_id
           ELSE excluded.last_delivered_change_id
         END,
         pending_change_id = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.pending_change_id
           ELSE NULL
         END,
         delivery_attempt_count = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.delivery_attempt_count
           ELSE 0
         END,
         delivery_next_attempt_at = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.delivery_next_attempt_at
           ELSE NULL
         END,
         lease_owner = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.lease_owner
           ELSE NULL
         END,
         lease_expires_at = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.lease_expires_at
           ELSE NULL
         END,
         last_error_code = CASE
           WHEN zapier_snapshot_subscriptions.status = 'active'
             AND zapier_snapshot_subscriptions.area = excluded.area
             AND zapier_snapshot_subscriptions.only_changed = excluded.only_changed
             THEN zapier_snapshot_subscriptions.last_error_code
           ELSE NULL
         END,
         updated_at = excluded.updated_at
       RETURNING subscription_id`
    )
    .bind(
      subscriptionId,
      input.targetUrl,
      input.area,
      input.onlyChanged ? 1 : 0,
      input.area,
      timestamp,
      timestamp
    )
    .first<SnapshotSubscriptionRow>();

  if (!row) {
    throw persistenceError();
  }
  return { id: row.subscription_id };
}

export async function disableSnapshotZapierSubscription(
  db: D1Database,
  subscriptionId: string,
  now: Date
): Promise<boolean> {
  validateSubscriptionId(subscriptionId);
  const timestamp = validateDate(now);
  const result = await db
    .prepare(
      `UPDATE zapier_snapshot_subscriptions
       SET status = 'disabled',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = 'zapier_subscription_disabled',
           updated_at = ?
       WHERE subscription_id = ?
         AND status = 'active'`
    )
    .bind(timestamp, subscriptionId)
    .run();
  return result.meta.changes === 1;
}

export async function claimNextSnapshotZapierDelivery(
  db: D1Database,
  leaseOwner: string,
  now: Date,
  leaseDurationSeconds: number
): Promise<SnapshotZapierDeliveryLease | null> {
  validateLeaseOwner(leaseOwner);
  if (
    !Number.isSafeInteger(leaseDurationSeconds) ||
    leaseDurationSeconds < 1 ||
    leaseDurationSeconds > 15 * 60
  ) {
    throw invalidInput();
  }

  const startedAt = validateDate(now);
  const leaseExpiresAt = new Date(
    now.getTime() + leaseDurationSeconds * 1_000
  ).toISOString();
  const uniqueLeaseOwner = `${leaseOwner}:${crypto.randomUUID()}`;
  const results = await db.batch<SnapshotDeliveryLeaseRow>([
    db
      .prepare(
        `UPDATE zapier_snapshot_subscriptions
         SET pending_change_id = (
               SELECT MIN(changes.change_id)
               FROM matool_snapshot_changes AS changes
               WHERE changes.area = zapier_snapshot_subscriptions.area
                 AND changes.change_id >
                   zapier_snapshot_subscriptions.last_delivered_change_id
                 AND changes.payload_json IS NOT NULL
                 AND changes.zapier_event_id IS NOT NULL
                 AND (
                   zapier_snapshot_subscriptions.only_changed = 0
                   OR changes.change_kind = 'updated'
                 )
             ),
             delivery_attempt_count = 0,
             delivery_next_attempt_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = NULL,
             updated_at = ?
         WHERE subscription_id = (
           SELECT subscriptions.subscription_id
           FROM zapier_snapshot_subscriptions AS subscriptions
           WHERE subscriptions.status = 'active'
             AND subscriptions.pending_change_id IS NULL
             AND EXISTS (
               SELECT 1
               FROM matool_snapshot_changes AS changes
               WHERE changes.area = subscriptions.area
                 AND changes.change_id > subscriptions.last_delivered_change_id
                 AND changes.payload_json IS NOT NULL
                 AND changes.zapier_event_id IS NOT NULL
                 AND (
                   subscriptions.only_changed = 0
                   OR changes.change_kind = 'updated'
                 )
             )
           ORDER BY (
                      SELECT MIN(changes.change_id)
                      FROM matool_snapshot_changes AS changes
                      WHERE changes.area = subscriptions.area
                        AND changes.change_id >
                          subscriptions.last_delivered_change_id
                        AND changes.payload_json IS NOT NULL
                        AND changes.zapier_event_id IS NOT NULL
                        AND (
                          subscriptions.only_changed = 0
                          OR changes.change_kind = 'updated'
                        )
                    ),
                    subscriptions.updated_at,
                    subscriptions.subscription_id
           LIMIT 1
         )`
      )
      .bind(startedAt, startedAt),
    db
      .prepare(
        `UPDATE zapier_snapshot_subscriptions
         SET delivery_attempt_count = delivery_attempt_count + 1,
             lease_owner = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE subscription_id = (
           SELECT subscriptions.subscription_id
           FROM zapier_snapshot_subscriptions AS subscriptions
           WHERE subscriptions.status = 'active'
             AND subscriptions.pending_change_id IS NOT NULL
             AND (
               (
                 subscriptions.lease_owner IS NULL
                 AND subscriptions.delivery_next_attempt_at <= ?
               )
               OR (
                 subscriptions.lease_expires_at IS NOT NULL
                 AND subscriptions.lease_expires_at <= ?
               )
             )
           ORDER BY subscriptions.delivery_next_attempt_at,
                    subscriptions.pending_change_id,
                    subscriptions.subscription_id
           LIMIT 1
         )`
      )
      .bind(
        uniqueLeaseOwner,
        leaseExpiresAt,
        startedAt,
        startedAt,
        startedAt
      ),
    db
      .prepare(
        `SELECT
           changes.area,
           subscriptions.delivery_attempt_count AS attempt_count,
           changes.change_id,
           changes.change_kind,
           changes.content_hash,
           changes.zapier_event_id AS event_id,
           snapshots.first_seen_at,
           snapshots.last_seen_at,
           changes.observed_at,
           changes.payload_json,
           changes.run_id,
           changes.source_id,
           subscriptions.subscription_id,
           subscriptions.target_url
         FROM zapier_snapshot_subscriptions AS subscriptions
         INNER JOIN matool_snapshot_changes AS changes
           ON changes.change_id = subscriptions.pending_change_id
         INNER JOIN matool_snapshots AS snapshots
           ON snapshots.area = changes.area
          AND snapshots.source_id = changes.source_id
         WHERE subscriptions.status = 'active'
           AND subscriptions.lease_owner = ?
           AND subscriptions.lease_expires_at = ?
           AND subscriptions.updated_at = ?
         LIMIT 1`
      )
      .bind(uniqueLeaseOwner, leaseExpiresAt, startedAt)
  ]);

  const row = results[2]?.results[0];
  if (!row) {
    return null;
  }
  return {
    area: row.area,
    attemptNumber: row.attempt_count,
    changeId: row.change_id,
    changeKind: row.change_kind,
    contentHash: row.content_hash,
    deliveryId: `${row.subscription_id}:${row.change_id}`,
    eventId: row.event_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    leaseOwner: uniqueLeaseOwner,
    observedAt: row.observed_at,
    payloadJson: row.payload_json,
    runId: row.run_id,
    sourceId: row.source_id,
    startedAt,
    subscriptionId: row.subscription_id,
    targetUrl: row.target_url
  };
}

export async function completeSnapshotZapierDelivery(
  db: D1Database,
  lease: SnapshotZapierDeliveryLease,
  now: Date
): Promise<void> {
  const timestamp = validateDate(now);
  const result = await db
    .prepare(
      `UPDATE zapier_snapshot_subscriptions
       SET last_delivered_change_id = pending_change_id,
           pending_change_id = NULL,
           delivery_attempt_count = 0,
           delivery_next_attempt_at = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = NULL,
           updated_at = ?
       WHERE subscription_id = ?
         AND status = 'active'
         AND pending_change_id = ?
         AND lease_owner = ?
         AND delivery_attempt_count = ?
         AND EXISTS (
           SELECT 1
           FROM matool_snapshot_changes
           WHERE change_id = ?
             AND zapier_event_id = ?
         )`
    )
    .bind(
      timestamp,
      lease.subscriptionId,
      lease.changeId,
      lease.leaseOwner,
      lease.attemptNumber,
      lease.changeId,
      lease.eventId
    )
    .run();
  assertLeaseUpdated(result.meta.changes);
}

export async function retrySnapshotZapierDelivery(
  db: D1Database,
  lease: SnapshotZapierDeliveryLease,
  errorCode: string,
  now: Date
): Promise<void> {
  validateErrorCode(errorCode);
  const timestamp = validateDate(now);
  const nextAttemptAt = new Date(
    now.getTime() + retryDelaySeconds(lease.attemptNumber) * 1_000
  ).toISOString();
  const result = await db
    .prepare(
      `UPDATE zapier_snapshot_subscriptions
       SET delivery_next_attempt_at = ?,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = ?,
           updated_at = ?
       WHERE subscription_id = ?
         AND status = 'active'
         AND pending_change_id = ?
         AND lease_owner = ?
         AND delivery_attempt_count = ?
         AND EXISTS (
           SELECT 1
           FROM matool_snapshot_changes
           WHERE change_id = ?
             AND zapier_event_id = ?
         )`
    )
    .bind(
      nextAttemptAt,
      errorCode,
      timestamp,
      lease.subscriptionId,
      lease.changeId,
      lease.leaseOwner,
      lease.attemptNumber,
      lease.changeId,
      lease.eventId
    )
    .run();
  assertLeaseUpdated(result.meta.changes);
}

export async function disableGoneSnapshotZapierSubscription(
  db: D1Database,
  lease: SnapshotZapierDeliveryLease,
  now: Date
): Promise<void> {
  const timestamp = validateDate(now);
  const result = await db
    .prepare(
      `UPDATE zapier_snapshot_subscriptions
       SET status = 'disabled',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = 'zapier_subscription_gone',
           updated_at = ?
       WHERE subscription_id = ?
         AND status = 'active'
         AND pending_change_id = ?
         AND lease_owner = ?
         AND delivery_attempt_count = ?
         AND EXISTS (
           SELECT 1
           FROM matool_snapshot_changes
           WHERE change_id = ?
             AND zapier_event_id = ?
         )`
    )
    .bind(
      timestamp,
      lease.subscriptionId,
      lease.changeId,
      lease.leaseOwner,
      lease.attemptNumber,
      lease.changeId,
      lease.eventId
    )
    .run();
  assertLeaseUpdated(result.meta.changes);
}

function retryDelaySeconds(attemptNumber: number): number {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw invalidInput();
  }
  return Math.min(3_600, 30 * 2 ** Math.min(10, attemptNumber - 1));
}

function assertLeaseUpdated(changes: number): void {
  if (changes !== 1) {
    throw new AppError(
      "snapshot_delivery_lease_lost",
      409,
      "Die Zapier-Snapshot-Zustellung besitzt keinen gueltigen Lease mehr."
    );
  }
}

function validateArea(area: string): void {
  if (
    area.length === 0 ||
    area.length > 64 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(area)
  ) {
    throw invalidInput();
  }
}

function validateTargetUrl(targetUrl: string): void {
  if (targetUrl.length === 0 || targetUrl.length > 2_048) {
    throw invalidInput();
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw invalidInput();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw invalidInput();
  }
}

function validateSubscriptionId(subscriptionId: string): void {
  if (!/^zsnap_[a-f0-9-]{36}$/u.test(subscriptionId)) {
    throw invalidInput();
  }
}

function validateLeaseOwner(leaseOwner: string): void {
  if (
    leaseOwner.length === 0 ||
    leaseOwner.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(leaseOwner)
  ) {
    throw invalidInput();
  }
}

function validateErrorCode(errorCode: string): void {
  if (
    errorCode.length === 0 ||
    errorCode.length > 96 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(errorCode)
  ) {
    throw invalidInput();
  }
}

function validateDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw invalidInput();
  }
  return value.toISOString();
}

function invalidInput(): AppError {
  return new AppError(
    "invalid_snapshot_delivery_input",
    400,
    "Die Zapier-Snapshot-Zustellung enthaelt ungueltige Eingaben."
  );
}

function persistenceError(): AppError {
  return new AppError(
    "snapshot_subscription_persistence_failed",
    503,
    "Das Zapier-Snapshot-Abonnement konnte nicht gespeichert werden."
  );
}
