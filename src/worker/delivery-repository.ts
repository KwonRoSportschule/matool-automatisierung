import { AppError } from "../core/app-error";
import {
  base64UrlEncodeBytes,
  sha256Hex
} from "../core/crypto";
import type { SinkResult } from "../sinks/zapier";
import type { Env } from "./env";

const ZAPIER_DESTINATION_PREFIX = "zapier-rest-hook:";
export const ZAPIER_CLAIM_WAIT_SECONDS = 5 * 60;
export const ZAPIER_DELIVERY_TOKEN_SECONDS = 15 * 60;

interface ClaimedEventRow {
  claim_id: string;
  event_id: string;
}

interface ExistingClaimRow {
  claim_id: string;
  confirmed_at: string | null;
  outcome: "succeeded" | "failed" | null;
}

interface OutboxLeaseRow {
  attempt_count: number;
  destination: string;
  event_id: string;
  outbox_id: string;
}

interface EventPayloadRow {
  payload_json: string;
  target_url: string;
}

interface DeliveryTokenLeaseRow {
  delivery_id: string;
}

interface LatestTokenExpiryRow {
  expires_at: string | null;
}

interface ClaimPayloadRow {
  payload_json: string;
}

interface ValidDeliveryTokenRow {
  delivery_id: string;
}

interface SubscriptionRow {
  subscription_id: string;
}

interface CountRow {
  count: number;
}

interface ExistingTransportClaimRow {
  event_id: string;
}

interface SubscriptionDisableDeliveryGuard {
  attemptNumber: number;
  deliveryId: string;
  destination: string;
  eventId: string;
  finishedAt: string;
}

export type ZapierClaimResult =
  | {
      claimId: string;
      claimed: true;
      eventPayloadJson: string;
      state: "claimed";
    }
  | {
      claimed: false;
      state: "already_claimed" | "already_confirmed" | "not_claimable";
    };

export type ZapierConfirmationResult =
  | { confirmed: true; state: "confirmed" | "already_confirmed" }
  | { confirmed: false; state: "not_claimable" };

export interface OutboxLease {
  attemptNumber: number;
  deliveryId: string;
  deliveryToken: string;
  destination: string;
  eventId: string;
  leaseOwner: string;
  outboxId: string;
  payloadJson: string;
  startedAt: string;
  targetUrl: string;
}

export interface ZapierClaimInput {
  deliveryId: string;
  deliveryToken: string;
  eventId: string;
}

export interface ZapierConfirmationInput {
  claimId: string;
  eventId: string;
  failureCode: string | null;
  outcome: "succeeded" | "failed";
}

export async function createZapierSubscription(
  env: Env,
  eventType: string,
  targetUrl: string,
  now: Date
): Promise<{ id: string }> {
  const subscriptionId = `zsub_${crypto.randomUUID()}`;
  const timestamp = now.toISOString();
  let row: SubscriptionRow | null;
  try {
    row = await env.DB.prepare(
      `INSERT INTO zapier_subscriptions (
         subscription_id,
         event_type,
         target_url,
         status,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(target_url) DO UPDATE SET
         event_type = excluded.event_type,
         status = 'active',
         updated_at = excluded.updated_at
       RETURNING subscription_id`
    )
      .bind(subscriptionId, eventType, targetUrl, timestamp, timestamp)
      .first<SubscriptionRow>();
  } catch {
    let activeConflict: SubscriptionRow | null = null;
    try {
      activeConflict = await env.DB.prepare(
        `SELECT subscription_id
         FROM zapier_subscriptions
         WHERE status = 'active'
           AND (event_type = ? OR target_url = ?)
         LIMIT 1`
      )
        .bind(eventType, targetUrl)
        .first<SubscriptionRow>();
    } catch {
      // Der ursprüngliche D1-Fehler wird unten als temporärer Serverfehler
      // klassifiziert, ohne interne Details nach außen zu geben.
    }

    if (activeConflict) {
      throw new AppError(
        "zapier_subscription_conflict",
        409,
        "Für diesen Ereignistyp ist bereits ein Zapier-Trigger aktiv."
      );
    }
    throw new AppError(
      "zapier_subscription_failed",
      503,
      "Das Zapier-Abonnement konnte vorübergehend nicht gespeichert werden."
    );
  }

  if (!row) {
    throw new AppError(
      "zapier_subscription_failed",
      500,
      "Das Zapier-Abonnement konnte nicht gespeichert werden."
    );
  }

  return { id: row.subscription_id };
}

export function getZapierSubscriptionId(destination: string): string {
  if (!destination.startsWith(ZAPIER_DESTINATION_PREFIX)) {
    throw new AppError(
      "invalid_zapier_destination",
      500,
      "Eine Zapier-Zustellung besitzt ein ungültiges Ziel."
    );
  }

  const subscriptionId = destination.slice(ZAPIER_DESTINATION_PREFIX.length);
  if (!/^zsub_[a-f0-9-]{36}$/u.test(subscriptionId)) {
    throw new AppError(
      "invalid_zapier_destination",
      500,
      "Eine Zapier-Zustellung besitzt ein ungültiges Ziel."
    );
  }

  return subscriptionId;
}

export async function disableZapierSubscription(
  env: Env,
  subscriptionId: string,
  now: Date
): Promise<boolean> {
  const timestamp = now.toISOString();
  const destination = `${ZAPIER_DESTINATION_PREFIX}${subscriptionId}`;
  const results = await env.DB.batch(
    buildDisableZapierSubscriptionStatements(
      env,
      subscriptionId,
      destination,
      timestamp
    )
  );

  return (results[0]?.meta.changes ?? 0) === 1;
}

function buildDisableZapierSubscriptionStatements(
  env: Env,
  subscriptionId: string,
  destination: string,
  timestamp: string,
  deliveryGuard?: SubscriptionDisableDeliveryGuard
): D1PreparedStatement[] {
  const deliveryGuardSql = deliveryGuard
    ? `AND EXISTS (
         SELECT 1
         FROM deliveries
         WHERE deliveries.delivery_id = ?
           AND deliveries.event_id = ?
           AND deliveries.destination = ?
           AND deliveries.attempt_number = ?
           AND deliveries.outcome = 'permanent_error'
           AND deliveries.http_status = 410
           AND deliveries.finished_at = ?
       )`
    : "";
  const deliveryGuardBindings = deliveryGuard
    ? [
        deliveryGuard.deliveryId,
        deliveryGuard.eventId,
        deliveryGuard.destination,
        deliveryGuard.attemptNumber,
        deliveryGuard.finishedAt
      ]
    : [];

  return [
    env.DB
      .prepare(
        `UPDATE zapier_subscriptions
         SET status = 'disabled',
             updated_at = ?
         WHERE subscription_id = ?
           AND status = 'active'
           ${deliveryGuardSql}`
      )
      .bind(timestamp, subscriptionId, ...deliveryGuardBindings),
    env.DB
      .prepare(
        `UPDATE outbox
         SET status = 'permanent_failure',
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = 'zapier_subscription_disabled',
             updated_at = ?
         WHERE destination = ?
           AND status IN ('pending', 'in_flight', 'retry_wait', 'accepted')
           ${deliveryGuardSql}
           AND NOT EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = outbox.event_id
           )`
      )
      .bind(timestamp, destination, ...deliveryGuardBindings),
    env.DB
      .prepare(
        `UPDATE events
         SET status = 'failed',
             updated_at = ?
         WHERE status IN ('queued', 'transport_accepted')
           ${deliveryGuardSql}
           AND NOT EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = events.event_id
           )
           AND EXISTS (
             SELECT 1
             FROM outbox
             WHERE outbox.event_id = events.event_id
               AND outbox.destination = ?
               AND outbox.status = 'permanent_failure'
               AND outbox.last_error_code = 'zapier_subscription_disabled'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM outbox
             WHERE outbox.event_id = events.event_id
               AND status IN ('pending', 'in_flight', 'retry_wait', 'accepted')
           )`
      )
      .bind(timestamp, ...deliveryGuardBindings, destination)
  ];
}

export async function countActiveZapierSubscriptions(
  env: Env
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM zapier_subscriptions
     WHERE status = 'active'`
  ).first<CountRow>();
  return row?.count ?? 0;
}

export async function enqueueZapierOutboxesForEvent(
  env: Env,
  eventId: string,
  now: Date
): Promise<number> {
  const timestamp = now.toISOString();
  const results = await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO outbox (
           outbox_id,
           event_id,
           destination,
           status,
           next_attempt_at,
           created_at,
           updated_at
         )
         SELECT
           'zout:' || events.event_id || ':' || subscriptions.subscription_id,
           events.event_id,
           ? || subscriptions.subscription_id,
           'pending',
           ?,
           ?,
           ?
         FROM events
         CROSS JOIN zapier_subscriptions AS subscriptions
         WHERE events.event_id = ?
           AND events.status IN ('approved', 'queued')
           AND subscriptions.status = 'active'
           AND subscriptions.event_type = events.event_type
         ON CONFLICT(event_id, destination) DO NOTHING`
      )
      .bind(
        ZAPIER_DESTINATION_PREFIX,
        timestamp,
        timestamp,
        timestamp,
        eventId
      ),
    env.DB
      .prepare(
        `UPDATE events
         SET status = 'queued',
             updated_at = ?
         WHERE event_id = ?
           AND status IN ('approved', 'queued')
           AND EXISTS (
             SELECT 1
             FROM outbox
             WHERE outbox.event_id = events.event_id
           )`
      )
      .bind(timestamp, eventId)
  ]);

  return results[0]?.meta.changes ?? 0;
}

export async function failExhaustedUnclaimedZapierOutboxes(
  env: Env,
  now: Date,
  maxAttempts: number
): Promise<number> {
  const timestamp = now.toISOString();
  const results = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE outbox
         SET status = 'permanent_failure',
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = CASE
               WHEN status = 'accepted'
                 AND last_error_code = 'zapier_prior_delivery_claim_wait'
                 THEN 'zapier_permanent_after_claim_wait'
               WHEN status = 'accepted'
                 AND last_error_code = 'zapier_ambiguous_final_attempt'
                 THEN 'zapier_retry_exhausted'
               WHEN status = 'accepted'
                 THEN 'zapier_claim_not_received'
               ELSE 'zapier_retry_exhausted'
             END,
             updated_at = ?
         WHERE destination LIKE ?
           AND (
             (
               status = 'accepted'
               AND next_attempt_at <= ?
               AND (
                 attempt_count >= ?
                 OR last_error_code = 'zapier_prior_delivery_claim_wait'
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM delivery_tokens
                 WHERE delivery_tokens.outbox_id = outbox.outbox_id
                   AND delivery_tokens.expires_at >= ?
               )
             )
             OR (
               status = 'in_flight'
               AND attempt_count >= ?
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM delivery_tokens
                 WHERE delivery_tokens.outbox_id = outbox.outbox_id
                   AND delivery_tokens.expires_at >= ?
               )
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = outbox.event_id
           )`
      )
      .bind(
        timestamp,
        `${ZAPIER_DESTINATION_PREFIX}%`,
        timestamp,
        maxAttempts,
        timestamp,
        maxAttempts,
        timestamp,
        timestamp
      ),
    env.DB
      .prepare(
        `UPDATE events
         SET status = 'failed',
             updated_at = ?
         WHERE status IN ('queued', 'transport_accepted')
           AND NOT EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = events.event_id
           )
           AND EXISTS (
             SELECT 1
             FROM outbox
             WHERE outbox.event_id = events.event_id
               AND outbox.status = 'permanent_failure'
               AND outbox.last_error_code IN (
                 'zapier_claim_not_received',
                 'zapier_permanent_after_claim_wait',
                 'zapier_retry_exhausted'
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM outbox
             WHERE outbox.event_id = events.event_id
               AND outbox.status IN (
                 'pending',
                 'in_flight',
                 'retry_wait',
                 'accepted'
               )
           )`
      )
      .bind(timestamp)
  ]);

  return results[0]?.meta.changes ?? 0;
}

export async function claimEventForZapier(
  env: Env,
  input: ZapierClaimInput,
  now: Date
): Promise<ZapierClaimResult> {
  const claimedAt = now.toISOString();
  const reviewAfter = new Date(now.getTime() + 15 * 60_000).toISOString();
  const claimId = `zclaim_${crypto.randomUUID()}`;
  const tokenHash = await sha256Hex(input.deliveryToken);
  const claimBatch = await env.DB.batch<ClaimedEventRow>([
    env.DB
      .prepare(
        `INSERT INTO event_claims (
           event_id,
           claim_id,
           delivery_id,
           claimed_by,
           claimed_at,
           review_after,
           updated_at
         )
         SELECT events.event_id, ?, tokens.delivery_id, tokens.destination,
                ?, ?, ?
         FROM delivery_tokens AS tokens
         INNER JOIN outbox ON outbox.outbox_id = tokens.outbox_id
         INNER JOIN events ON events.event_id = tokens.event_id
         WHERE tokens.delivery_id = ?
           AND tokens.event_id = ?
           AND tokens.token_hash = ?
           AND tokens.consumed_at IS NULL
           AND tokens.expires_at >= ?
           AND outbox.event_id = events.event_id
           AND outbox.destination = tokens.destination
           AND outbox.status IN ('in_flight', 'retry_wait', 'accepted')
           AND events.status IN ('queued', 'transport_accepted')
         ON CONFLICT(event_id) DO NOTHING
         RETURNING event_id, claim_id`
      )
      .bind(
        claimId,
        claimedAt,
        reviewAfter,
        claimedAt,
        input.deliveryId,
        input.eventId,
        tokenHash,
        claimedAt
      ),
    env.DB
      .prepare(
        `UPDATE delivery_tokens
         SET consumed_at = COALESCE(consumed_at, ?)
         WHERE delivery_id = ?
           AND EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = delivery_tokens.event_id
               AND event_claims.delivery_id = delivery_tokens.delivery_id
               AND event_claims.claim_id = ?
           )`
      )
      .bind(claimedAt, input.deliveryId, claimId),
    env.DB
      .prepare(
        `INSERT INTO deliveries (
           delivery_id,
           event_id,
           destination,
           attempt_number,
           outcome,
           http_status,
           started_at,
           finished_at
         )
         SELECT tokens.delivery_id,
                tokens.event_id,
                tokens.destination,
                tokens.attempt_number,
                'accepted',
                NULL,
                tokens.created_at,
                ?
         FROM delivery_tokens AS tokens
         INNER JOIN event_claims
           ON event_claims.delivery_id = tokens.delivery_id
         WHERE tokens.delivery_id = ?
           AND event_claims.event_id = tokens.event_id
           AND event_claims.claim_id = ?
         ON CONFLICT(event_id, destination, attempt_number) DO UPDATE SET
           outcome = 'accepted',
           finished_at = excluded.finished_at
         WHERE deliveries.delivery_id = excluded.delivery_id`
      )
      .bind(claimedAt, input.deliveryId, claimId),
    env.DB
      .prepare(
        `UPDATE outbox
         SET status = 'accepted',
             next_attempt_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = NULL,
             updated_at = ?
         WHERE event_id = ?
           AND status IN ('in_flight', 'retry_wait', 'accepted')
           AND EXISTS (
             SELECT 1
             FROM delivery_tokens
             INNER JOIN event_claims
               ON event_claims.delivery_id = delivery_tokens.delivery_id
             WHERE delivery_tokens.outbox_id = outbox.outbox_id
               AND delivery_tokens.delivery_id = ?
               AND event_claims.event_id = outbox.event_id
               AND event_claims.claim_id = ?
           )`
      )
      .bind(
        reviewAfter,
        claimedAt,
        input.eventId,
        input.deliveryId,
        claimId
      ),
    env.DB
      .prepare(
        `UPDATE events
         SET status = 'transport_accepted',
             updated_at = ?
         WHERE event_id = ?
           AND status = 'queued'
           AND EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = events.event_id
               AND event_claims.claim_id = ?
           )`
      )
      .bind(claimedAt, input.eventId, claimId)
  ]);
  const inserted = claimBatch[0]?.results[0];

  if (inserted) {
    const event = await env.DB.prepare(
      `SELECT payload_json
       FROM events
       WHERE event_id = ?`
    )
      .bind(input.eventId)
      .first<ClaimPayloadRow>();
    if (!event) {
      throw new AppError(
        "claimed_event_missing",
        500,
        "Das beanspruchte Ereignis konnte nicht geladen werden."
      );
    }

    return {
      claimId: inserted.claim_id,
      claimed: true,
      eventPayloadJson: event.payload_json,
      state: "claimed"
    };
  }

  const validToken = await env.DB.prepare(
    `SELECT tokens.delivery_id
     FROM delivery_tokens AS tokens
     INNER JOIN outbox ON outbox.outbox_id = tokens.outbox_id
     WHERE tokens.delivery_id = ?
       AND tokens.event_id = ?
       AND tokens.token_hash = ?
       AND tokens.expires_at >= ?
       AND outbox.event_id = tokens.event_id
       AND outbox.destination = tokens.destination
       AND outbox.status IN ('in_flight', 'retry_wait', 'accepted')`
  )
    .bind(input.deliveryId, input.eventId, tokenHash, claimedAt)
    .first<ValidDeliveryTokenRow>();
  if (!validToken) {
    return { claimed: false, state: "not_claimable" };
  }

  const existing = await env.DB.prepare(
    `SELECT claim_id, confirmed_at, outcome
     FROM event_claims
     WHERE event_id = ?`
  )
    .bind(input.eventId)
    .first<ExistingClaimRow>();

  if (!existing) {
    return { claimed: false, state: "not_claimable" };
  }

  return {
    claimed: false,
    state: existing.confirmed_at ? "already_confirmed" : "already_claimed"
  };
}

export async function confirmEventForZapier(
  env: Env,
  input: ZapierConfirmationInput,
  now: Date
): Promise<ZapierConfirmationResult> {
  const confirmedAt = now.toISOString();
  const existing = await env.DB.prepare(
    `SELECT claim_id, confirmed_at, outcome
     FROM event_claims
     WHERE event_id = ?
       AND claim_id = ?`
  )
    .bind(input.eventId, input.claimId)
    .first<ExistingClaimRow>();
  if (!existing) {
    return { confirmed: false, state: "not_claimable" };
  }
  if (existing.confirmed_at) {
    if (existing.outcome !== input.outcome) {
      throw new AppError(
        "claim_outcome_conflict",
        409,
        "Für diesen Claim wurde bereits ein anderes Ergebnis gespeichert."
      );
    }
    return { confirmed: true, state: "already_confirmed" };
  }

  const results = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE event_claims
         SET confirmed_at = ?,
             outcome = ?,
             failure_code = ?,
             updated_at = ?
         WHERE event_id = ?
           AND claim_id = ?
           AND confirmed_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM events
             WHERE events.event_id = event_claims.event_id
               AND status IN ('queued', 'transport_accepted', 'action_confirmed')
           )`
      )
      .bind(
        confirmedAt,
        input.outcome,
        input.failureCode,
        confirmedAt,
        input.eventId,
        input.claimId
      ),
    env.DB
      .prepare(
        `UPDATE events
         SET status = ?,
             updated_at = ?
         WHERE event_id = ?
           AND status IN ('queued', 'transport_accepted', 'action_confirmed')
           AND EXISTS (
             SELECT 1
             FROM event_claims
             WHERE event_claims.event_id = events.event_id
               AND claim_id = ?
               AND confirmed_at IS NOT NULL
               AND outcome = ?
           )`
      )
      .bind(
        input.outcome === "succeeded" ? "action_confirmed" : "failed",
        confirmedAt,
        input.eventId,
        input.claimId,
        input.outcome
      )
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const current = await env.DB.prepare(
      `SELECT claim_id, confirmed_at, outcome
       FROM event_claims
       WHERE event_id = ?
         AND claim_id = ?`
    )
      .bind(input.eventId, input.claimId)
      .first<ExistingClaimRow>();
    if (current?.confirmed_at) {
      if (current.outcome !== input.outcome) {
        throw new AppError(
          "claim_outcome_conflict",
          409,
          "Für diesen Claim wurde bereits ein anderes Ergebnis gespeichert."
        );
      }
      return { confirmed: true, state: "already_confirmed" };
    }

    return { confirmed: false, state: "not_claimable" };
  }

  return {
    confirmed: true,
    state: "confirmed"
  };
}

export async function claimNextZapierOutbox(
  env: Env,
  leaseOwner: string,
  now: Date,
  leaseDurationSeconds: number,
  maxAttempts = 8
): Promise<OutboxLease | null> {
  const startedAt = now.toISOString();
  const leaseExpiresAt = new Date(
    now.getTime() + leaseDurationSeconds * 1000
  ).toISOString();
  const deliveryToken = base64UrlEncodeBytes(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const tokenHash = await sha256Hex(deliveryToken);
  const tokenExpiresAt = new Date(
    now.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1000
  ).toISOString();
  const leaseBatch = await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE outbox
         SET status = 'in_flight',
             attempt_count = attempt_count + 1,
             lease_owner = ?,
             lease_expires_at = ?,
             updated_at = ?
         WHERE outbox_id = (
           SELECT outbox.outbox_id
           FROM outbox
           INNER JOIN events ON events.event_id = outbox.event_id
           INNER JOIN zapier_subscriptions AS subscriptions
             ON outbox.destination = ? || subscriptions.subscription_id
           WHERE subscriptions.status = 'active'
             AND events.status IN ('queued', 'transport_accepted')
             AND outbox.attempt_count < ?
             AND NOT EXISTS (
               SELECT 1
               FROM event_claims
               WHERE event_claims.event_id = outbox.event_id
             )
             AND (
               (
                 outbox.status IN ('pending', 'retry_wait')
                 AND outbox.next_attempt_at <= ?
               )
               OR (
                 outbox.status = 'in_flight'
                 AND outbox.lease_expires_at IS NOT NULL
                 AND outbox.lease_expires_at <= ?
               )
               OR (
                 outbox.status = 'accepted'
                 AND outbox.last_error_code IS NULL
                 AND outbox.next_attempt_at <= ?
               )
             )
           ORDER BY outbox.next_attempt_at, outbox.created_at
           LIMIT 1
         )
         RETURNING outbox_id, event_id, destination, attempt_count`
      )
      .bind(
        leaseOwner,
        leaseExpiresAt,
        startedAt,
        ZAPIER_DESTINATION_PREFIX,
        maxAttempts,
        startedAt,
        startedAt,
        startedAt
      ),
    env.DB
      .prepare(
        `INSERT INTO delivery_tokens (
           delivery_id,
           outbox_id,
           event_id,
           destination,
           attempt_number,
           token_hash,
           expires_at,
           created_at
         )
         SELECT outbox_id || ':' || attempt_count,
                outbox_id,
                event_id,
                destination,
                attempt_count,
                ?,
                ?,
                ?
         FROM outbox
         WHERE status = 'in_flight'
           AND lease_owner = ?
           AND lease_expires_at = ?
           AND updated_at = ?
         RETURNING delivery_id`
      )
      .bind(
        tokenHash,
        tokenExpiresAt,
        startedAt,
        leaseOwner,
        leaseExpiresAt,
        startedAt
      ),
    env.DB
      .prepare(
        `SELECT events.payload_json, subscriptions.target_url
         FROM outbox
         INNER JOIN events ON events.event_id = outbox.event_id
         INNER JOIN zapier_subscriptions AS subscriptions
           ON outbox.destination = ? || subscriptions.subscription_id
         WHERE outbox.status = 'in_flight'
           AND outbox.lease_owner = ?
           AND outbox.lease_expires_at = ?
           AND outbox.updated_at = ?
           AND subscriptions.status = 'active'`
      )
      .bind(
        ZAPIER_DESTINATION_PREFIX,
        leaseOwner,
        leaseExpiresAt,
        startedAt
      )
  ]);
  const row = leaseBatch[0]?.results[0] as OutboxLeaseRow | undefined;

  if (!row) {
    return null;
  }
  const tokenRow = leaseBatch[1]?.results[0] as
    | DeliveryTokenLeaseRow
    | undefined;
  const event = leaseBatch[2]?.results[0] as EventPayloadRow | undefined;
  if (!tokenRow || !event) {
    throw new AppError(
      "outbox_lease_incomplete",
      500,
      "Eine Outbox-Zustellung konnte nicht vollständig vorbereitet werden."
    );
  }

  return {
    attemptNumber: row.attempt_count,
    deliveryId: tokenRow.delivery_id,
    deliveryToken,
    destination: row.destination,
    eventId: row.event_id,
    leaseOwner,
    outboxId: row.outbox_id,
    payloadJson: event.payload_json,
    startedAt,
    targetUrl: event.target_url
  };
}

export async function finalizeZapierOutboxAttempt(
  env: Env,
  lease: OutboxLease,
  result: SinkResult,
  now: Date,
  maxAttempts: number
): Promise<
  "accepted" | "claim_wait" | "retry_wait" | "permanent_failure"
> {
  const finishedAt = now.toISOString();
  const canAwaitPriorDelivery =
    result.outcome === "permanent_error" &&
    result.errorCode !== "zapier_subscription_gone";
  const priorLiveToken = canAwaitPriorDelivery
    ? await env.DB.prepare(
        `SELECT MAX(expires_at) AS expires_at
         FROM delivery_tokens
         WHERE outbox_id = ?
           AND delivery_id <> ?
           AND consumed_at IS NULL
           AND expires_at >= ?`
      )
        .bind(lease.outboxId, lease.deliveryId, finishedAt)
        .first<LatestTokenExpiryRow>()
    : null;
  const priorDeliveryClaimDeadline =
    typeof priorLiveToken?.expires_at === "string"
      ? priorLiveToken.expires_at
      : null;
  const waitsForPriorDeliveryClaim =
    priorDeliveryClaimDeadline !== null;
  const exhaustedAmbiguousAttempt =
    result.outcome === "retryable_error" &&
    lease.attemptNumber >= maxAttempts;
  const finalState =
    result.outcome === "accepted"
      ? "accepted"
      : result.outcome === "permanent_error"
        ? waitsForPriorDeliveryClaim
          ? "claim_wait"
          : "permanent_failure"
        : exhaustedAmbiguousAttempt
          ? "claim_wait"
          : "retry_wait";
  const persistedState =
    finalState === "claim_wait" ? "accepted" : finalState;
  const deliveryId = lease.deliveryId;
  const errorCode =
    result.outcome === "accepted"
      ? null
      : waitsForPriorDeliveryClaim
        ? "zapier_prior_delivery_claim_wait"
        : exhaustedAmbiguousAttempt
        ? "zapier_ambiguous_final_attempt"
        : result.errorCode;
  const nextAttemptAt =
    finalState === "accepted"
      ? new Date(
          now.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1000
        ).toISOString()
      : finalState === "claim_wait"
        ? waitsForPriorDeliveryClaim
          ? priorDeliveryClaimDeadline
          : new Date(
              Date.parse(lease.startedAt) +
                ZAPIER_DELIVERY_TOKEN_SECONDS * 1000
            ).toISOString()
        : finalState === "retry_wait"
          ? new Date(
              now.getTime() +
                retryDelaySeconds(lease.attemptNumber) * 1000
            ).toISOString()
          : finishedAt;

  const ownershipSql = `
    outbox_id = ?
    AND event_id = ?
    AND destination = ?
    AND status = 'in_flight'
    AND lease_owner = ?
    AND attempt_count = ?`;
  const ownershipBindings = [
    lease.outboxId,
    lease.eventId,
    lease.destination,
    lease.leaseOwner,
    lease.attemptNumber
  ] as const;

  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `INSERT INTO deliveries (
           delivery_id,
           event_id,
           destination,
           attempt_number,
           outcome,
           http_status,
           started_at,
           finished_at
         )
         SELECT ?, event_id, destination, ?, ?, ?, ?, ?
         FROM outbox
         WHERE ${ownershipSql}
         ON CONFLICT(event_id, destination, attempt_number) DO NOTHING`
      )
      .bind(
        deliveryId,
        lease.attemptNumber,
        result.outcome,
        result.httpStatus,
        lease.startedAt,
        finishedAt,
        ...ownershipBindings
      )
  ];

  statements.push(
    env.DB
      .prepare(
        `UPDATE outbox
         SET status = ?,
             next_attempt_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = ?,
             updated_at = ?
         WHERE ${ownershipSql}`
      )
      .bind(
        persistedState,
        nextAttemptAt,
        errorCode,
        finishedAt,
        ...ownershipBindings
      )
  );

  if (finalState === "accepted") {
    statements.push(
      env.DB
        .prepare(
          `UPDATE events
           SET status = 'transport_accepted',
               updated_at = ?
           WHERE event_id = ?
             AND status = 'queued'
             AND EXISTS (
               SELECT 1
               FROM outbox
               WHERE outbox.event_id = events.event_id
                 AND status = 'accepted'
             )`
        )
        .bind(finishedAt, lease.eventId)
    );
  } else if (finalState === "permanent_failure") {
    statements.push(
      env.DB
        .prepare(
          `UPDATE events
           SET status = 'failed',
               updated_at = ?
           WHERE event_id = ?
             AND status IN ('queued', 'transport_accepted')
             AND EXISTS (
               SELECT 1
               FROM outbox
               WHERE outbox.event_id = events.event_id
             )
             AND NOT EXISTS (
               SELECT 1
               FROM outbox
               WHERE outbox.event_id = events.event_id
                 AND status IN ('pending', 'in_flight', 'retry_wait', 'accepted')
             )`
        )
        .bind(finishedAt, lease.eventId)
    );
  }

  if (
    result.outcome === "permanent_error" &&
    result.errorCode === "zapier_subscription_gone"
  ) {
    const subscriptionId = getZapierSubscriptionId(lease.destination);
    statements.push(
      ...buildDisableZapierSubscriptionStatements(
        env,
        subscriptionId,
        lease.destination,
        finishedAt,
        {
          attemptNumber: lease.attemptNumber,
          deliveryId: lease.deliveryId,
          destination: lease.destination,
          eventId: lease.eventId,
          finishedAt
        }
      )
    );
  }

  const batchResult = await env.DB.batch(statements);
  if ((batchResult[1]?.meta.changes ?? 0) !== 1) {
    const acceptedByClaim = await env.DB.prepare(
      `SELECT event_claims.event_id
       FROM event_claims
       INNER JOIN delivery_tokens
         ON delivery_tokens.delivery_id = event_claims.delivery_id
       INNER JOIN outbox
         ON outbox.outbox_id = delivery_tokens.outbox_id
       WHERE event_claims.event_id = ?
         AND outbox.outbox_id = ?
         AND outbox.destination = ?
         AND outbox.status = 'accepted'`
    )
      .bind(lease.eventId, lease.outboxId, lease.destination)
      .first<ExistingTransportClaimRow>();
    if (acceptedByClaim) {
      return "accepted";
    }

    throw new AppError(
      "outbox_lease_lost",
      409,
      "Die Outbox-Zustellung besitzt keinen gültigen Lease mehr."
    );
  }

  return finalState;
}

function retryDelaySeconds(attemptNumber: number): number {
  return Math.min(3_600, 30 * 2 ** Math.max(0, attemptNumber - 1));
}
