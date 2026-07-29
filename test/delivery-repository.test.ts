import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../src/core/crypto";
import {
  claimEventForZapier,
  claimNextZapierOutbox,
  confirmEventForZapier,
  createZapierSubscription,
  disableZapierSubscription,
  enqueueZapierOutboxesForEvent,
  failExhaustedUnclaimedZapierOutboxes,
  finalizeZapierOutboxAttempt,
  ZAPIER_CLAIM_WAIT_SECONDS,
  ZAPIER_DELIVERY_TOKEN_SECONDS,
  type OutboxLease
} from "../src/worker/delivery-repository";
import type { Env } from "../src/worker/env";
import { processZapierOutbox } from "../src/worker/outbox";

const BASE_TIME = new Date("2030-01-02T10:00:00.000Z");
const LEASE_SECONDS = 30;
const MAX_ATTEMPTS = 8;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_claims"),
    env.DB.prepare("DELETE FROM deliveries"),
    env.DB.prepare("DELETE FROM delivery_tokens"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM records"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB.prepare("DELETE FROM zapier_subscriptions")
  ]);
});

interface SyntheticSeed {
  email: string;
  eventId: string;
  firstName: string;
  phone: string;
  subscriptionId: string;
}

async function seedQueuedEvent(label: string): Promise<SyntheticSeed> {
  const unique = crypto.randomUUID();
  const eventId = await sha256Hex(`synthetic-event:${label}:${unique}`);
  const eventType = `prospect.first_trial_contact_due.${label}.${unique}`;
  const runId = `run-${unique}`;
  const sourceKey = `synthetic-source-${unique}`;
  const email = `synthetic-${unique}@example.invalid`;
  const firstName = `Synthetic-${label}`;
  const phone = `+49000${unique.replaceAll("-", "").slice(0, 8)}`;
  const payloadJson = JSON.stringify({
    contact: {
      channel: "email",
      dueAt: BASE_TIME.toISOString()
    },
    eventId,
    eventType,
    firstTrial: {
      appointmentId: `appointment-${unique}`,
      locationCode: "synthetic-location",
      startsAt: new Date(BASE_TIME.getTime() + 86_400_000).toISOString()
    },
    occurredAt: BASE_TIME.toISOString(),
    payloadVersion: 1,
    prospect: {
      email,
      firstName,
      phone
    },
    sourceKey
  });

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO runs (
           run_id,
           collector,
           mode,
           trigger_kind,
           status,
           started_at,
           finished_at,
           fencing_token
         )
         VALUES (?, 'interessenten_first_trial', 'active', 'test',
                 'succeeded', ?, ?, 1)`
      )
      .bind(runId, BASE_TIME.toISOString(), BASE_TIME.toISOString()),
    env.DB
      .prepare(
        `INSERT INTO records (
           collector,
           source_key,
           source_revision,
           payload_version,
           payload_json,
           first_seen_at,
           last_seen_at,
           last_run_id,
           fencing_token
         )
         VALUES ('interessenten_first_trial', ?, ?, 1, ?, ?, ?, ?, 1)`
      )
      .bind(
        sourceKey,
        `revision-${unique}`,
        JSON.stringify({ synthetic: true }),
        BASE_TIME.toISOString(),
        BASE_TIME.toISOString(),
        runId
      ),
    env.DB
      .prepare(
        `INSERT INTO events (
           event_id,
           collector,
           event_type,
           source_key,
           payload_version,
           payload_json,
           status,
           created_run_id,
           created_at,
           updated_at,
           fencing_token
         )
         VALUES (?, 'interessenten_first_trial', ?, ?, 1, ?, 'approved',
                 ?, ?, ?, 1)`
      )
      .bind(
        eventId,
        eventType,
        sourceKey,
        payloadJson,
        runId,
        BASE_TIME.toISOString(),
        BASE_TIME.toISOString()
      )
  ]);

  const targetUrl = [
    "https://hooks.",
    "zapier.com/",
    unique,
    "/synthetic"
  ].join("");
  const subscription = await createZapierSubscription(
    env,
    eventType,
    targetUrl,
    BASE_TIME
  );
  await expect(
    enqueueZapierOutboxesForEvent(env, eventId, BASE_TIME)
  ).resolves.toBe(1);

  return {
    email,
    eventId,
    firstName,
    phone,
    subscriptionId: subscription.id
  };
}

async function leaseSeededEvent(
  label: string,
  now = BASE_TIME,
  owner = `owner-${label}`
): Promise<{ lease: OutboxLease; seed: SyntheticSeed }> {
  const seed = await seedQueuedEvent(label);
  const lease = await claimNextZapierOutbox(
    env,
    owner,
    now,
    LEASE_SECONDS,
    MAX_ATTEMPTS
  );
  expect(lease).not.toBeNull();
  return { lease: lease as OutboxLease, seed };
}

describe("D1-Zustellclaims und Outbox-Leases", () => {
  it("vergibt bei 20 parallelen Outbox-Claims genau einen Lease", async () => {
    const seed = await seedQueuedEvent("parallel-outbox-lease");

    const leases = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        claimNextZapierOutbox(
          env,
          `parallel-owner-${index}`,
          BASE_TIME,
          LEASE_SECONDS,
          MAX_ATTEMPTS
        )
      )
    );
    const winners = leases.filter(
      (lease): lease is OutboxLease => lease !== null
    );

    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      attemptNumber: 1,
      eventId: seed.eventId
    });
    const outbox = await env.DB.prepare(
      `SELECT attempt_count, lease_owner, status
       FROM outbox
       WHERE event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        attempt_count: number;
        lease_owner: string;
        status: string;
      }>();
    expect(outbox).toEqual({
      attempt_count: 1,
      lease_owner: winners[0]?.leaseOwner,
      status: "in_flight"
    });
    const tokenCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM delivery_tokens
       WHERE event_id = ?`
    )
      .bind(seed.eventId)
      .first<{ count: number }>();
    expect(tokenCount?.count).toBe(1);
  });

  it("vergibt bei 20 parallelen Claims genau einen Event-Claim", async () => {
    const { lease, seed } = await leaseSeededEvent("parallel-claim");
    const input = {
      deliveryId: lease.deliveryId,
      deliveryToken: lease.deliveryToken,
      eventId: seed.eventId
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimEventForZapier(env, input, BASE_TIME)
      )
    );

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          !result.claimed && result.state === "already_claimed"
      )
    ).toHaveLength(19);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM event_claims WHERE event_id = ?"
    )
      .bind(seed.eventId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("liefert bei falschem Delivery-Token keine Personendaten", async () => {
    const { lease, seed } = await leaseSeededEvent("wrong-token");

    const result = await claimEventForZapier(
      env,
      {
        deliveryId: lease.deliveryId,
        deliveryToken: "synthetic-but-wrong-delivery-token",
        eventId: seed.eventId
      },
      BASE_TIME
    );

    expect(result).toEqual({
      claimed: false,
      state: "not_claimable"
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(seed.email);
    expect(serialized).not.toContain(seed.firstName);
    expect(serialized).not.toContain(seed.phone);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM event_claims WHERE event_id = ?"
    )
      .bind(seed.eventId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("erlaubt den Claim während der Hook-Request noch in_flight ist", async () => {
    const { lease, seed } = await leaseSeededEvent("claim-race");

    const claimed = await claimEventForZapier(
      env,
      {
        deliveryId: lease.deliveryId,
        deliveryToken: lease.deliveryToken,
        eventId: seed.eventId
      },
      new Date(BASE_TIME.getTime() + 1_000)
    );
    expect(claimed).toMatchObject({
      claimed: true,
      state: "claimed"
    });
    const claimedTransport = await env.DB.prepare(
      `SELECT events.status AS event_status, outbox.status AS outbox_status
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{ event_status: string; outbox_status: string }>();
    expect(claimedTransport).toEqual({
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });

    await expect(
      finalizeZapierOutboxAttempt(
        env,
        lease,
        { outcome: "accepted", httpStatus: 200 },
        new Date(BASE_TIME.getTime() + 2_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("accepted");

    const afterWait = new Date(
      BASE_TIME.getTime() +
        2_000 +
        ZAPIER_CLAIM_WAIT_SECONDS * 1000 +
        1
    );
    await expect(
      claimNextZapierOutbox(
        env,
        "owner-after-claim",
        afterWait,
        LEASE_SECONDS,
        MAX_ATTEMPTS
      )
    ).resolves.toBeNull();
  });

  it("ersetzt retry_wait durch Claim-bestätigte Transportannahme", async () => {
    const { lease, seed } = await leaseSeededEvent("claim-after-timeout");
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        lease,
        {
          outcome: "retryable_error",
          httpStatus: null,
          errorCode: "zapier_network_error"
        },
        new Date(BASE_TIME.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("retry_wait");

    await expect(
      claimEventForZapier(
        env,
        {
          deliveryId: lease.deliveryId,
          deliveryToken: lease.deliveryToken,
          eventId: seed.eventId
        },
        new Date(BASE_TIME.getTime() + 2_000)
      )
    ).resolves.toMatchObject({
      claimed: true,
      state: "claimed"
    });

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              deliveries.outcome AS delivery_outcome
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       INNER JOIN deliveries ON deliveries.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        delivery_outcome: string;
        event_status: string;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      delivery_outcome: "accepted",
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });
  });

  it("verhindert die Finalisierung durch einen abgelösten Lease-Owner", async () => {
    const { lease: staleLease, seed } =
      await leaseSeededEvent("lease-fencing");
    const replacementTime = new Date(
      BASE_TIME.getTime() + (LEASE_SECONDS + 1) * 1000
    );
    const replacementLease = await claimNextZapierOutbox(
      env,
      "replacement-owner",
      replacementTime,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(replacementLease).not.toBeNull();
    expect(replacementLease?.attemptNumber).toBe(2);

    await expect(
      finalizeZapierOutboxAttempt(
        env,
        staleLease,
        { outcome: "accepted", httpStatus: 200 },
        new Date(replacementTime.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).rejects.toMatchObject({
      code: "outbox_lease_lost"
    });

    const outbox = await env.DB.prepare(
      `SELECT attempt_count, lease_owner, status
       FROM outbox
       WHERE event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        attempt_count: number;
        lease_owner: string;
        status: string;
      }>();
    expect(outbox).toMatchObject({
      attempt_count: 2,
      lease_owner: "replacement-owner",
      status: "in_flight"
    });
    const deliveries = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?"
    )
      .bind(seed.eventId)
      .first<{ count: number }>();
    expect(deliveries?.count).toBe(0);
  });

  it("behandelt Finalisierer derselben Outbox nach einem Claim als akzeptiert", async () => {
    const { lease: staleLease, seed } =
      await leaseSeededEvent("claim-attempt-fencing");
    const replacementTime = new Date(
      BASE_TIME.getTime() + (LEASE_SECONDS + 1) * 1000
    );
    const replacementLease = await claimNextZapierOutbox(
      env,
      "claim-replacement-owner",
      replacementTime,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(replacementLease).not.toBeNull();

    const claim = await claimEventForZapier(
      env,
      {
        deliveryId: replacementLease?.deliveryId ?? "",
        deliveryToken: replacementLease?.deliveryToken ?? "",
        eventId: seed.eventId
      },
      new Date(replacementTime.getTime() + 1_000)
    );
    expect(claim).toMatchObject({ claimed: true });

    await expect(
      finalizeZapierOutboxAttempt(
        env,
        staleLease,
        { outcome: "accepted", httpStatus: 200 },
        new Date(replacementTime.getTime() + 2_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("accepted");
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        replacementLease as OutboxLease,
        { outcome: "accepted", httpStatus: 200 },
        new Date(replacementTime.getTime() + 3_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("accepted");

    const deliveries = await env.DB.prepare(
      `SELECT attempt_number
       FROM deliveries
       WHERE event_id = ?`
    )
      .bind(seed.eventId)
      .all<{ attempt_number: number }>();
    expect(deliveries.results).toEqual([{ attempt_number: 2 }]);
  });

  it("stellt nach akzeptiertem HTTP nur ohne Event-Claim erneut zu", async () => {
    const { lease, seed } = await leaseSeededEvent("unclaimed-redelivery");
    const acceptedAt = new Date(BASE_TIME.getTime() + 1_000);
    await finalizeZapierOutboxAttempt(
      env,
      lease,
      { outcome: "accepted", httpStatus: 202 },
      acceptedAt,
      MAX_ATTEMPTS
    );

    const beforeWait = new Date(
      acceptedAt.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1000 - 1
    );
    await expect(
      claimNextZapierOutbox(
        env,
        "owner-too-early",
        beforeWait,
        LEASE_SECONDS,
        MAX_ATTEMPTS
      )
    ).resolves.toBeNull();

    const afterWait = new Date(
      acceptedAt.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1000 + 1
    );
    const redelivery = await claimNextZapierOutbox(
      env,
      "owner-redelivery",
      afterWait,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(redelivery).toMatchObject({
      attemptNumber: 2,
      eventId: seed.eventId,
      leaseOwner: "owner-redelivery"
    });
    expect(redelivery?.deliveryId).not.toBe(lease.deliveryId);
  });

  it("wartet nach dem letzten ambigen Versuch bis zum Tokenablauf auf einen Claim", async () => {
    const seed = await seedQueuedEvent("ambiguous-final-attempt");
    await env.DB.prepare(
      `UPDATE outbox
       SET attempt_count = ?
       WHERE event_id = ?`
    )
      .bind(MAX_ATTEMPTS - 1, seed.eventId)
      .run();
    const lease = await claimNextZapierOutbox(
      env,
      "owner-ambiguous-final",
      BASE_TIME,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(lease).toMatchObject({
      attemptNumber: MAX_ATTEMPTS,
      eventId: seed.eventId
    });
    if (!lease) {
      throw new Error("synthetic final lease unexpectedly missing");
    }

    const finishedAt = new Date(BASE_TIME.getTime() + 10_000);
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        lease,
        {
          outcome: "retryable_error",
          httpStatus: null,
          errorCode: "zapier_network_error"
        },
        finishedAt,
        MAX_ATTEMPTS
      )
    ).resolves.toBe("claim_wait");

    const waitingState = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code,
              outbox.next_attempt_at
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        next_attempt_at: string;
        outbox_status: string;
      }>();
    expect(waitingState).toEqual({
      event_status: "queued",
      last_error_code: "zapier_ambiguous_final_attempt",
      next_attempt_at: new Date(
        BASE_TIME.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1_000
      ).toISOString(),
      outbox_status: "accepted"
    });

    const delayedClaimAt = new Date(
      BASE_TIME.getTime() + LEASE_SECONDS * 1_000 + 1
    );
    await expect(
      claimEventForZapier(
        env,
        {
          deliveryId: lease.deliveryId,
          deliveryToken: lease.deliveryToken,
          eventId: seed.eventId
        },
        delayedClaimAt
      )
    ).resolves.toMatchObject({
      claimed: true,
      state: "claimed"
    });
  });

  it("beendet ausgeschöpfte akzeptierte Zustellungen ohne Claim atomar", async () => {
    const { lease: unclaimedLease, seed: unclaimed } =
      await leaseSeededEvent("max-attempts-unclaimed");
    const acceptedAt = new Date(BASE_TIME.getTime() + 1_000);
    await finalizeZapierOutboxAttempt(
      env,
      unclaimedLease,
      { outcome: "accepted", httpStatus: 200 },
      acceptedAt,
      MAX_ATTEMPTS
    );
    await env.DB.prepare(
      `UPDATE outbox
       SET attempt_count = ?
       WHERE event_id = ?`
    )
      .bind(MAX_ATTEMPTS, unclaimed.eventId)
      .run();

    const { lease: claimedLease, seed: claimed } =
      await leaseSeededEvent("max-attempts-claimed");
    const claim = await claimEventForZapier(
      env,
      {
        deliveryId: claimedLease.deliveryId,
        deliveryToken: claimedLease.deliveryToken,
        eventId: claimed.eventId
      },
      acceptedAt
    );
    expect(claim).toMatchObject({ claimed: true });
    await env.DB.prepare(
      `UPDATE outbox
       SET attempt_count = ?,
           next_attempt_at = ?
       WHERE event_id = ?`
    )
      .bind(MAX_ATTEMPTS, acceptedAt.toISOString(), claimed.eventId)
      .run();

    const afterClaimWait = new Date(
      acceptedAt.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1000 + 1
    );
    let fetchCalls = 0;
    const enabledEnv = {
      ...env,
      OUTBOUND_DELIVERY_ENABLED: "true"
    } as Env;
    const summary = await processZapierOutbox(enabledEnv, {
      fetchImplementation: (async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
      maxItems: 1,
      now: () => afterClaimWait
    });
    expect(summary.permanentFailures).toBe(0);
    expect(summary.processed).toBe(0);
    expect(fetchCalls).toBe(0);

    const afterTokenExpiry = new Date(
      BASE_TIME.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1_000 + 1
    );
    const expiredSummary = await processZapierOutbox(enabledEnv, {
      fetchImplementation: (async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
      maxItems: 1,
      now: () => afterTokenExpiry
    });
    expect(expiredSummary.permanentFailures).toBe(1);
    expect(expiredSummary.processed).toBe(0);
    expect(fetchCalls).toBe(0);

    const unclaimedState = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(unclaimed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
      }>();
    expect(unclaimedState).toEqual({
      event_status: "failed",
      last_error_code: "zapier_claim_not_received",
      outbox_status: "permanent_failure"
    });

    const claimedState = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              COUNT(event_claims.event_id) AS claim_count
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       LEFT JOIN event_claims ON event_claims.event_id = events.event_id
       WHERE events.event_id = ?
       GROUP BY events.status, outbox.status`
    )
      .bind(claimed.eventId)
      .first<{
        claim_count: number;
        event_status: string;
        outbox_status: string;
      }>();
    expect(claimedState).toEqual({
      claim_count: 1,
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });
  });

  it("hält den letzten In-flight-Versuch bis zum Tokenablauf claimbar", async () => {
    const { lease, seed } =
      await leaseSeededEvent("max-attempts-in-flight-claim");
    await env.DB.prepare(
      `UPDATE outbox
       SET attempt_count = ?
       WHERE event_id = ?`
    )
      .bind(MAX_ATTEMPTS, seed.eventId)
      .run();

    const afterLeaseExpiry = new Date(
      BASE_TIME.getTime() + LEASE_SECONDS * 1_000 + 1
    );
    await expect(
      failExhaustedUnclaimedZapierOutboxes(
        env,
        afterLeaseExpiry,
        MAX_ATTEMPTS
      )
    ).resolves.toBe(0);

    await expect(
      claimEventForZapier(
        env,
        {
          deliveryId: lease.deliveryId,
          deliveryToken: lease.deliveryToken,
          eventId: seed.eventId
        },
        afterLeaseExpiry
      )
    ).resolves.toMatchObject({
      claimed: true,
      state: "claimed"
    });

    const claimableState = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        outbox_status: string;
      }>();
    expect(claimableState).toEqual({
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });

    const { seed: expiredSeed } =
      await leaseSeededEvent("max-attempts-in-flight-expired");
    await env.DB.prepare(
      `UPDATE outbox
       SET attempt_count = ?
       WHERE event_id = ?`
    )
      .bind(MAX_ATTEMPTS, expiredSeed.eventId)
      .run();
    const afterTokenExpiry = new Date(
      BASE_TIME.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1_000 + 1
    );
    await expect(
      failExhaustedUnclaimedZapierOutboxes(
        env,
        afterTokenExpiry,
        MAX_ATTEMPTS
      )
    ).resolves.toBe(1);

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code,
              outbox.lease_owner
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(expiredSeed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        lease_owner: string | null;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      event_status: "failed",
      last_error_code: "zapier_retry_exhausted",
      lease_owner: null,
      outbox_status: "permanent_failure"
    });
  });

  it("hält einen älteren akzeptierten Versuch trotz späterem permanenten Fehler claimbar", async () => {
    const { lease: firstLease, seed } =
      await leaseSeededEvent("accepted-then-permanent");
    const acceptedAt = new Date(BASE_TIME.getTime() + 1_000);
    await finalizeZapierOutboxAttempt(
      env,
      firstLease,
      { outcome: "accepted", httpStatus: 202 },
      acceptedAt,
      MAX_ATTEMPTS
    );

    const retryAt = new Date(
      acceptedAt.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1_000 + 1
    );
    const secondLease = await claimNextZapierOutbox(
      env,
      "owner-permanent-second-attempt",
      retryAt,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(secondLease).not.toBeNull();
    if (!secondLease) {
      throw new Error("synthetic second lease unexpectedly missing");
    }
    const permanentAt = new Date(retryAt.getTime() + 1_000);
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        secondLease,
        {
          outcome: "permanent_error",
          httpStatus: 400,
          errorCode: "zapier_rejected"
        },
        permanentAt,
        MAX_ATTEMPTS
      )
    ).resolves.toBe("claim_wait");

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      event_status: "transport_accepted",
      last_error_code: "zapier_prior_delivery_claim_wait",
      outbox_status: "accepted"
    });

    await expect(
      claimEventForZapier(
        env,
        {
          deliveryId: firstLease.deliveryId,
          deliveryToken: firstLease.deliveryToken,
          eventId: seed.eventId
        },
        new Date(permanentAt.getTime() + 1_000)
      )
    ).resolves.toMatchObject({
      claimed: true,
      state: "claimed"
    });
  });

  it("beendet einen ersten permanent abgelehnten Versuch sofort", async () => {
    const { lease, seed } =
      await leaseSeededEvent("initial-permanent-rejection");
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        lease,
        {
          outcome: "permanent_error",
          httpStatus: 400,
          errorCode: "zapier_rejected"
        },
        new Date(BASE_TIME.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("permanent_failure");

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      event_status: "failed",
      last_error_code: "zapier_rejected",
      outbox_status: "permanent_failure"
    });
  });

  it("beendet den Prior-Claim-Wartezustand nach Ablauf aller Tokens", async () => {
    const { lease: firstLease, seed } =
      await leaseSeededEvent("prior-claim-wait-expiry");
    const acceptedAt = new Date(BASE_TIME.getTime() + 1_000);
    await finalizeZapierOutboxAttempt(
      env,
      firstLease,
      { outcome: "accepted", httpStatus: 202 },
      acceptedAt,
      MAX_ATTEMPTS
    );

    const retryAt = new Date(
      acceptedAt.getTime() + ZAPIER_CLAIM_WAIT_SECONDS * 1_000 + 1
    );
    const secondLease = await claimNextZapierOutbox(
      env,
      "owner-prior-wait-expiry",
      retryAt,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    if (!secondLease) {
      throw new Error("synthetic second lease unexpectedly missing");
    }
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        secondLease,
        {
          outcome: "permanent_error",
          httpStatus: 400,
          errorCode: "zapier_rejected"
        },
        new Date(retryAt.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("claim_wait");

    const afterPriorTokenExpiry = new Date(
      BASE_TIME.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1_000 + 1
    );
    await expect(
      failExhaustedUnclaimedZapierOutboxes(
        env,
        afterPriorTokenExpiry,
        MAX_ATTEMPTS
      )
    ).resolves.toBe(0);
    await expect(
      claimNextZapierOutbox(
        env,
        "owner-prior-wait-must-not-retry",
        afterPriorTokenExpiry,
        LEASE_SECONDS,
        MAX_ATTEMPTS
      )
    ).resolves.toBeNull();

    const afterAllTokenExpiry = new Date(
      retryAt.getTime() + ZAPIER_DELIVERY_TOKEN_SECONDS * 1_000 + 1
    );
    await expect(
      failExhaustedUnclaimedZapierOutboxes(
        env,
        afterAllTokenExpiry,
        MAX_ATTEMPTS
      )
    ).resolves.toBe(1);

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      event_status: "failed",
      last_error_code: "zapier_permanent_after_claim_wait",
      outbox_status: "permanent_failure"
    });
  });

  it("akzeptiert die Finalisierung, wenn ein älterer Token den neueren Lease überholt", async () => {
    const { lease: firstLease, seed } =
      await leaseSeededEvent("older-token-wins-finalize-race");
    const firstFinishedAt = new Date(BASE_TIME.getTime() + 1_000);
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        firstLease,
        {
          outcome: "retryable_error",
          httpStatus: null,
          errorCode: "zapier_network_error"
        },
        firstFinishedAt,
        MAX_ATTEMPTS
      )
    ).resolves.toBe("retry_wait");

    const retryAt = new Date(firstFinishedAt.getTime() + 30_001);
    const secondLease = await claimNextZapierOutbox(
      env,
      "owner-older-token-race",
      retryAt,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    if (!secondLease) {
      throw new Error("synthetic second lease unexpectedly missing");
    }
    await expect(
      claimEventForZapier(
        env,
        {
          deliveryId: firstLease.deliveryId,
          deliveryToken: firstLease.deliveryToken,
          eventId: seed.eventId
        },
        new Date(retryAt.getTime() + 500)
      )
    ).resolves.toMatchObject({
      claimed: true,
      state: "claimed"
    });

    await expect(
      finalizeZapierOutboxAttempt(
        env,
        secondLease,
        {
          outcome: "permanent_error",
          httpStatus: 400,
          errorCode: "zapier_rejected"
        },
        new Date(retryAt.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("accepted");

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              COUNT(event_claims.event_id) AS claim_count
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       LEFT JOIN event_claims ON event_claims.event_id = events.event_id
       WHERE events.event_id = ?
       GROUP BY events.status, outbox.status`
    )
      .bind(seed.eventId)
      .first<{
        claim_count: number;
        event_status: string;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      claim_count: 1,
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });
  });

  it("deaktiviert eine mit 410 entfernte Subscription in derselben Finalisierung", async () => {
    const { lease, seed } = await leaseSeededEvent("subscription-gone");
    await expect(
      finalizeZapierOutboxAttempt(
        env,
        lease,
        {
          outcome: "permanent_error",
          httpStatus: 410,
          errorCode: "zapier_subscription_gone"
        },
        new Date(BASE_TIME.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).resolves.toBe("permanent_failure");

    const state = await env.DB.prepare(
      `SELECT subscriptions.status AS subscription_status,
              events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM zapier_subscriptions AS subscriptions
       INNER JOIN outbox
         ON outbox.destination = 'zapier-rest-hook:' ||
           subscriptions.subscription_id
       INNER JOIN events ON events.event_id = outbox.event_id
       WHERE subscriptions.subscription_id = ?`
    )
      .bind(seed.subscriptionId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
        subscription_status: string;
      }>();
    expect(state).toEqual({
      event_status: "failed",
      last_error_code: "zapier_subscription_gone",
      outbox_status: "permanent_failure",
      subscription_status: "disabled"
    });
  });

  it("lässt einen abgelaufenen 410-Lease keine neue Zustellung deaktivieren", async () => {
    const { lease: staleLease, seed } =
      await leaseSeededEvent("stale-subscription-gone");
    const replacementTime = new Date(
      BASE_TIME.getTime() + (LEASE_SECONDS + 1) * 1_000
    );
    const replacementLease = await claimNextZapierOutbox(
      env,
      "owner-after-stale-410",
      replacementTime,
      LEASE_SECONDS,
      MAX_ATTEMPTS
    );
    expect(replacementLease).not.toBeNull();

    await expect(
      finalizeZapierOutboxAttempt(
        env,
        staleLease,
        {
          outcome: "permanent_error",
          httpStatus: 410,
          errorCode: "zapier_subscription_gone"
        },
        new Date(replacementTime.getTime() + 1_000),
        MAX_ATTEMPTS
      )
    ).rejects.toMatchObject({
      code: "outbox_lease_lost"
    });

    const state = await env.DB.prepare(
      `SELECT subscriptions.status AS subscription_status,
              events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.attempt_count,
              outbox.lease_owner,
              COUNT(deliveries.delivery_id) AS delivery_count
       FROM zapier_subscriptions AS subscriptions
       INNER JOIN outbox
         ON outbox.destination = 'zapier-rest-hook:' ||
           subscriptions.subscription_id
       INNER JOIN events ON events.event_id = outbox.event_id
       LEFT JOIN deliveries ON deliveries.event_id = events.event_id
       WHERE subscriptions.subscription_id = ?
       GROUP BY subscriptions.status, events.status, outbox.status,
                outbox.attempt_count, outbox.lease_owner`
    )
      .bind(seed.subscriptionId)
      .first<{
        attempt_count: number;
        delivery_count: number;
        event_status: string;
        lease_owner: string;
        outbox_status: string;
        subscription_status: string;
      }>();
    expect(state).toEqual({
      attempt_count: 2,
      delivery_count: 0,
      event_status: "queued",
      lease_owner: "owner-after-stale-410",
      outbox_status: "in_flight",
      subscription_status: "active"
    });
  });

  it("meldet parallele widersprüchliche Bestätigungen als Konflikt", async () => {
    const { lease, seed } = await leaseSeededEvent("confirmation-race");
    const claim = await claimEventForZapier(
      env,
      {
        deliveryId: lease.deliveryId,
        deliveryToken: lease.deliveryToken,
        eventId: seed.eventId
      },
      BASE_TIME
    );
    expect(claim).toMatchObject({ claimed: true });
    if (!claim.claimed) {
      throw new Error("synthetic claim unexpectedly failed");
    }

    const results = await Promise.allSettled([
      confirmEventForZapier(
        env,
        {
          claimId: claim.claimId,
          eventId: seed.eventId,
          failureCode: null,
          outcome: "succeeded"
        },
        new Date(BASE_TIME.getTime() + 1_000)
      ),
      confirmEventForZapier(
        env,
        {
          claimId: claim.claimId,
          eventId: seed.eventId,
          failureCode: "synthetic_failure",
          outcome: "failed"
        },
        new Date(BASE_TIME.getTime() + 1_000)
      )
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected"
    );
    expect(rejected).toMatchObject({
      reason: { code: "claim_outcome_conflict" },
      status: "rejected"
    });
  });

  it("beendet eine akzeptierte ungeclaimte Zustellung beim Deaktivieren", async () => {
    const { lease, seed } = await leaseSeededEvent(
      "disable-unclaimed-accepted"
    );
    await finalizeZapierOutboxAttempt(
      env,
      lease,
      { outcome: "accepted", httpStatus: 200 },
      new Date(BASE_TIME.getTime() + 1_000),
      MAX_ATTEMPTS
    );

    await expect(
      disableZapierSubscription(
        env,
        seed.subscriptionId,
        new Date(BASE_TIME.getTime() + 2_000)
      )
    ).resolves.toBe(true);

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.last_error_code
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        event_status: string;
        last_error_code: string | null;
        outbox_status: string;
      }>();
    expect(state).toEqual({
      event_status: "failed",
      last_error_code: "zapier_subscription_disabled",
      outbox_status: "permanent_failure"
    });
  });

  it("lässt vorhandene Claims beim Deaktivieren unverändert", async () => {
    const { lease, seed } = await leaseSeededEvent("disable-claimed");
    const claim = await claimEventForZapier(
      env,
      {
        deliveryId: lease.deliveryId,
        deliveryToken: lease.deliveryToken,
        eventId: seed.eventId
      },
      new Date(BASE_TIME.getTime() + 1_000)
    );
    expect(claim).toMatchObject({ claimed: true });

    await disableZapierSubscription(
      env,
      seed.subscriptionId,
      new Date(BASE_TIME.getTime() + 2_000)
    );

    const state = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              event_claims.claim_id
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       INNER JOIN event_claims ON event_claims.event_id = events.event_id
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId)
      .first<{
        claim_id: string;
        event_status: string;
        outbox_status: string;
      }>();
    expect(state).toMatchObject({
      claim_id: "claimId" in claim ? claim.claimId : "",
      event_status: "transport_accepted",
      outbox_status: "accepted"
    });
  });
});
