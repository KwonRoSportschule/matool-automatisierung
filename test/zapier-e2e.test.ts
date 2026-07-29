import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  hmacSha256Base64Url,
  sha256Hex
} from "../src/core/crypto";
import {
  FIRST_TRIAL_COLLECTOR,
  FIRST_TRIAL_EVENT_TYPE,
  type ProspectContactEvent
} from "../src/core/first-trial";
import {
  createZapierSubscription,
  enqueueZapierOutboxesForEvent
} from "../src/worker/delivery-repository";
import type { Env } from "../src/worker/env";
import worker from "../src/worker";
import { processZapierOutbox } from "../src/worker/outbox";

interface HookEnvelope {
  delivery_id: string;
  delivery_token: string;
  event_id: string;
  event_type: string;
  schema_version: number;
}

interface ClaimedZapierEvent {
  claim_id: string;
  event_id: string;
  event_type: string;
  prospect: {
    email: string | null;
    first_name: string | null;
    phone: string | null;
  };
}

type ClaimResponse =
  | {
      claimed: true;
      event: ClaimedZapierEvent;
      state: "claimed";
    }
  | {
      claimed: false;
      state: "already_claimed" | "already_confirmed" | "not_claimable";
    };

interface SeededEvent {
  email: string;
  eventId: string;
  firstName: string;
  phone: string;
  targetUrl: string;
}

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

async function dispatch(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

function serviceRequest(
  path: string,
  serviceToken: string,
  body: Record<string, unknown>
): Request {
  return new Request(`http://127.0.0.1${path}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

async function seedQueuedEvent(now: Date): Promise<SeededEvent> {
  const unique = crypto.randomUUID();
  const eventId = await sha256Hex(`synthetic-e2e:${unique}`);
  const runId = `run-${unique}`;
  const sourceKey = `synthetic-source-${unique}`;
  const email = `synthetic-${unique}@example.invalid`;
  const firstName = `Synthetic-E2E-${unique}`;
  const phone = `+49000${unique.replaceAll("-", "").slice(0, 8)}`;
  const timestamp = now.toISOString();
  const event: ProspectContactEvent = {
    contact: {
      channel: "email",
      dueAt: timestamp
    },
    eventId,
    eventType: FIRST_TRIAL_EVENT_TYPE,
    firstTrial: {
      appointmentId: `appointment-${unique}`,
      locationCode: "synthetic-location",
      startsAt: new Date(now.getTime() + 86_400_000).toISOString()
    },
    occurredAt: timestamp,
    payloadVersion: 1,
    prospect: {
      email,
      firstName,
      phone
    },
    sourceKey
  };

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
         VALUES (?, ?, 'active', 'test', 'succeeded', ?, ?, 1)`
      )
      .bind(
        runId,
        FIRST_TRIAL_COLLECTOR,
        timestamp,
        timestamp
      ),
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
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, 1)`
      )
      .bind(
        FIRST_TRIAL_COLLECTOR,
        sourceKey,
        `revision-${unique}`,
        JSON.stringify({ synthetic: true }),
        timestamp,
        timestamp,
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
         VALUES (?, ?, ?, ?, 1, ?, 'approved', ?, ?, ?, 1)`
      )
      .bind(
        eventId,
        FIRST_TRIAL_COLLECTOR,
        FIRST_TRIAL_EVENT_TYPE,
        sourceKey,
        JSON.stringify(event),
        runId,
        timestamp,
        timestamp
      )
  ]);

  const targetUrl = [
    "https://hooks.",
    "zapier.com/",
    unique,
    "/synthetic-e2e"
  ].join("");
  await createZapierSubscription(
    env,
    FIRST_TRIAL_EVENT_TYPE,
    targetUrl,
    now
  );
  await expect(
    enqueueZapierOutboxesForEvent(env, eventId, now)
  ).resolves.toBe(1);

  return {
    email,
    eventId,
    firstName,
    phone,
    targetUrl
  };
}

describe("Zapier-End-to-End-Pfad", () => {
  it("signiert den PII-freien Hook, claimt und bestätigt genau einmal", async () => {
    const now = new Date();
    const seed = await seedQueuedEvent(now);
    const serviceToken = env.ZAPIER_SERVICE_TOKEN;
    const signingSecret = env.ZAPIER_WEBHOOK_SIGNING_SECRET;
    if (!serviceToken || !signingSecret) {
      throw new Error("Synthetische Test-Bindings fehlen.");
    }

    const claimResponses: ClaimResponse[] = [];
    const claimedPayloads: ClaimedZapierEvent[] = [];
    const hookErrors: unknown[] = [];
    let confirmedActions = 0;
    const capturedHookRequests: Request[] = [];

    const handleSyntheticHook = async (
      hookRequest: Request
    ): Promise<Response> => {
      expect(hookRequest.url).toBe(seed.targetUrl);
      expect(hookRequest.method).toBe("POST");
      expect(hookRequest.redirect).toBe("manual");
      expect(hookRequest.headers.get("Content-Type")).toBe(
        "application/json"
      );

      const body = await hookRequest.text();
      const envelope = JSON.parse(body) as HookEnvelope;
      expect(body).toBe(canonicalJson(envelope));
      expect(Object.keys(envelope)).toEqual([
        "delivery_id",
        "delivery_token",
        "event_id",
        "event_type",
        "schema_version"
      ]);
      expect(envelope).toMatchObject({
        event_id: seed.eventId,
        event_type: FIRST_TRIAL_EVENT_TYPE,
        schema_version: 1
      });
      expect(envelope.delivery_token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(body).not.toContain(seed.email);
      expect(body).not.toContain(seed.firstName);
      expect(body).not.toContain(seed.phone);
      expect(body).not.toContain('"prospect":');

      const timestamp = hookRequest.headers.get("X-Matool-Timestamp");
      expect(timestamp).toMatch(/^\d{10}$/u);
      expect(hookRequest.headers.get("X-Matool-Event-Id")).toBe(
        seed.eventId
      );
      const expectedSignature = await hmacSha256Base64Url(
        signingSecret,
        `${timestamp}.${body}`
      );
      expect(hookRequest.headers.get("X-Matool-Signature")).toBe(
        `v1=${expectedSignature}`
      );

      const claimResponse = await dispatch(
        serviceRequest(
          "/api/zapier/v1/events/claim",
          serviceToken,
          {
            delivery_id: envelope.delivery_id,
            delivery_token: envelope.delivery_token,
            event_id: envelope.event_id
          }
        )
      );
      expect(claimResponse.status).toBe(200);
      const claim = (await claimResponse.json()) as ClaimResponse;
      claimResponses.push(claim);

      if (!claim.claimed) {
        expect(claim).not.toHaveProperty("event");
        const serialized = JSON.stringify(claim);
        expect(serialized).not.toContain(seed.email);
        expect(serialized).not.toContain(seed.firstName);
        expect(serialized).not.toContain(seed.phone);
        return new Response(null, { status: 200 });
      }

      claimedPayloads.push(claim.event);
      expect(claim.event).toMatchObject({
        claim_id: expect.stringMatching(/^zclaim_[a-f0-9-]{36}$/u),
        event_id: seed.eventId,
        event_type: FIRST_TRIAL_EVENT_TYPE,
        prospect: {
          email: seed.email,
          first_name: seed.firstName,
          phone: null
        }
      });

      const confirmationResponse = await dispatch(
        serviceRequest(
          "/api/zapier/v1/events/confirm",
          serviceToken,
          {
            claim_id: claim.event.claim_id,
            event_id: claim.event.event_id,
            outcome: "succeeded"
          }
        )
      );
      expect(confirmationResponse.status).toBe(200);
      await expect(confirmationResponse.json()).resolves.toMatchObject({
        confirmed: true,
        state: "confirmed"
      });
      confirmedActions += 1;

      return new Response(null, { status: 200 });
    };

    const syntheticZapierFetch = (async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1]
    ): Promise<Response> => {
      const hookRequest = new Request(input, init);
      capturedHookRequests.push(hookRequest.clone());
      try {
        return await handleSyntheticHook(hookRequest);
      } catch (error) {
        hookErrors.push(error);
        return new Response(null, { status: 500 });
      }
    }) as typeof fetch;
    const enabledEnv = {
      ...env,
      OUTBOUND_DELIVERY_ENABLED: "true"
    } as Env;

    const summary = await processZapierOutbox(enabledEnv, {
      fetchImplementation: syntheticZapierFetch,
      maxItems: 1,
      now: () => new Date()
    });

    if (hookErrors[0]) {
      throw hookErrors[0];
    }
    expect(summary).toEqual({
      accepted: 1,
      awaitingClaims: 0,
      disabled: false,
      permanentFailures: 0,
      processed: 1,
      retriesScheduled: 0
    });
    expect(capturedHookRequests).toHaveLength(1);
    expect(claimResponses).toHaveLength(1);
    expect(claimResponses[0]).toMatchObject({
      claimed: true,
      state: "claimed"
    });
    expect(claimedPayloads).toHaveLength(1);
    expect(confirmedActions).toBe(1);

    const firstState = await env.DB.prepare(
      `SELECT events.status AS event_status,
              outbox.status AS outbox_status,
              outbox.attempt_count,
              claims.claim_count,
              claims.confirmed_count,
              deliveries.delivery_count,
              tokens.token_count
       FROM events
       INNER JOIN outbox ON outbox.event_id = events.event_id
       CROSS JOIN (
         SELECT COUNT(*) AS claim_count,
                COUNT(confirmed_at) AS confirmed_count
         FROM event_claims
         WHERE event_id = ?
       ) AS claims
       CROSS JOIN (
         SELECT COUNT(*) AS delivery_count
         FROM deliveries
         WHERE event_id = ?
       ) AS deliveries
       CROSS JOIN (
         SELECT COUNT(*) AS token_count
         FROM delivery_tokens
         WHERE event_id = ?
       ) AS tokens
       WHERE events.event_id = ?`
    )
      .bind(seed.eventId, seed.eventId, seed.eventId, seed.eventId)
      .first<{
        attempt_count: number;
        claim_count: number;
        confirmed_count: number;
        delivery_count: number;
        event_status: string;
        outbox_status: string;
        token_count: number;
      }>();
    expect(firstState).toEqual({
      attempt_count: 1,
      claim_count: 1,
      confirmed_count: 1,
      delivery_count: 1,
      event_status: "action_confirmed",
      outbox_status: "accepted",
      token_count: 1
    });

    const capturedHookRequest = capturedHookRequests[0];
    if (!capturedHookRequest) {
      throw new Error("Der synthetische Hook wurde nicht erfasst.");
    }
    await expect(
      handleSyntheticHook(capturedHookRequest.clone())
    ).resolves.toMatchObject({ status: 200 });

    expect(claimResponses).toHaveLength(2);
    expect(claimResponses[1]).toEqual({
      claimed: false,
      schema_version: 1,
      state: "already_confirmed"
    });
    expect(claimedPayloads).toHaveLength(1);
    expect(confirmedActions).toBe(1);

    const finalCounts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_claims WHERE event_id = ?) AS claim_count,
         (SELECT COUNT(*) FROM deliveries WHERE event_id = ?) AS delivery_count,
         (SELECT status FROM events WHERE event_id = ?) AS event_status`
    )
      .bind(seed.eventId, seed.eventId, seed.eventId)
      .first<{
        claim_count: number;
        delivery_count: number;
        event_status: string;
      }>();
    expect(finalCounts).toEqual({
      claim_count: 1,
      delivery_count: 1,
      event_status: "action_confirmed"
    });
  });
});
