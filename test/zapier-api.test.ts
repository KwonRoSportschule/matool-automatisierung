import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { FIRST_TRIAL_EVENT_TYPE } from "../src/core/first-trial";
import worker from "../src/worker";

const serviceToken =
  "synthetic-service-token-at-least-32-characters";

async function dispatch(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

function serviceRequest(
  path: string,
  init: RequestInit = {}
): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serviceToken}`);
  return new Request(`https://middleware.example.invalid${path}`, {
    ...init,
    headers
  });
}

describe("Zapier-Service-API", () => {
  it("akzeptiert den Service-Token ohne Cloudflare-Access-JWT", async () => {
    const response = await dispatch(
      new Request("https://middleware.example.invalid/api/zapier/v1/account", {
        headers: {
          Authorization: `Bearer ${serviceToken}`
        }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "kwonro-matool-middleware",
      schema_version: 1
    });
  });

  it("verlangt den eigenen Service-Token", async () => {
    const missing = await dispatch(
      new Request("https://middleware.example.invalid/api/zapier/v1/account")
    );
    const wrong = await dispatch(
      new Request("https://middleware.example.invalid/api/zapier/v1/account", {
        headers: {
          Authorization: `Bearer ${"x".repeat(40)}`
        }
      })
    );

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "integration_access_denied" }
    });
  });

  it("liefert dem authentifizierten Client nur nicht-sensitive Metadaten", async () => {
    const response = await dispatch(
      serviceRequest("/api/zapier/v1/account")
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      schema_version: 1,
      id: "kwonro-matool-middleware",
      environment: "test",
      event_types: [],
      token_scopes: ["snapshots:read"]
    });
    expect(payload).not.toHaveProperty("subscription_limit_per_event_type");
    expect(serialized).not.toContain(serviceToken);
    expect(serialized).not.toContain("secret");
  });

  it("liefert dem Zap-Editor ausschließlich synthetische Beispieldaten", async () => {
    const response = await dispatch(
      serviceRequest("/api/zapier/v1/events/sample", {
        body: JSON.stringify({
          event_type: FIRST_TRIAL_EVENT_TYPE
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );
    const payload = (await response.json()) as {
      events: Array<Record<string, unknown>>;
    };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      event_id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      event_type: FIRST_TRIAL_EVENT_TYPE,
      claim_id: expect.stringMatching(/^zclaim_[a-f0-9-]{36}$/u),
      prospect: {
        email: "beispiel@example.invalid"
      }
    });
    expect(payload.events[0]?.id).toBe(payload.events[0]?.event_id);
    expect(serialized).not.toContain("@kwonro");
    expect(serialized).not.toContain("+49");
  });

  it("weist fremde Webhook-Ziele zurück", async () => {
    const response = await dispatch(
      serviceRequest("/api/zapier/v1/subscriptions", {
        body: JSON.stringify({
          event_type: FIRST_TRIAL_EVENT_TYPE,
          target_url:
            "https://hooks.zapier.com.attacker.invalid/hooks/standard/x"
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("registriert und entfernt genau die authentifizierte REST-Hook-Subscription", async () => {
    const targetUrl = [
      "https://hooks.",
      "zapier.com/",
      crypto.randomUUID(),
      "/synthetic"
    ].join("");
    const created = await dispatch(
      serviceRequest("/api/zapier/v1/subscriptions", {
        body: JSON.stringify({
          event_type: FIRST_TRIAL_EVENT_TYPE,
          target_url: targetUrl
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );
    const createdPayload = (await created.json()) as { id: string };

    expect(created.status).toBe(201);
    expect(createdPayload.id).toMatch(/^zsub_[a-f0-9-]{36}$/u);

    const conflicting = await dispatch(
      serviceRequest("/api/zapier/v1/subscriptions", {
        body: JSON.stringify({
          event_type: FIRST_TRIAL_EVENT_TYPE,
          target_url: [
            "https://hooks.",
            "zapier.com/",
            crypto.randomUUID(),
            "/synthetic-conflict"
          ].join("")
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );
    expect(conflicting.status).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({
      error: { code: "zapier_subscription_conflict" }
    });

    const disabled = await dispatch(
      serviceRequest(
        `/api/zapier/v1/subscriptions/${createdPayload.id}`,
        { method: "DELETE" }
      )
    );
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      id: createdPayload.id,
      disabled: true
    });

    const idempotent = await dispatch(
      serviceRequest(
        `/api/zapier/v1/subscriptions/${createdPayload.id}`,
        { method: "DELETE" }
      )
    );
    expect(idempotent.status).toBe(200);
  });

  it("gibt bei einem ungültigen Claim niemals Personendaten aus", async () => {
    const response = await dispatch(
      serviceRequest("/api/zapier/v1/events/claim", {
        body: JSON.stringify({
          delivery_id: "zdelivery_missing-claim",
          delivery_token: "A".repeat(43),
          event_id: "a".repeat(64)
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      schema_version: 1,
      claimed: false
    });
    expect(serialized).not.toContain("prospect");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
  });

  it("schützt Zapier-Felder vor Kollisionen in Interessenten-Details", async () => {
    const runId = `snapshot_interessenten_details_${crypto.randomUUID()}`;
    const observedAt = "2026-08-10T13:00:00.000Z";
    const sourceId = `9${Date.now()}`;
    const secondSourceId = `${sourceId}1`;
    const firstHash = "a".repeat(64);
    const unchangedHash = "c".repeat(64);
    const payload = {
      id: "payload-id-must-not-win",
      area: "payload-area-must-not-win",
      source_id: "payload-source-must-not-win",
      matool_id: "payload-matool-id-must-not-win",
      content_hash: "payload-hash-must-not-win",
      first_seen_at: "payload-first-seen-must-not-win",
      last_changed_at: "payload-last-changed-must-not-win",
      last_seen_at: "payload-last-seen-must-not-win",
      is_new: false,
      vorname: "Beispiel"
    };
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO matool_snapshot_runs (
             run_id, area, status, started_at, finished_at,
             fetched_count, success_count, failure_count, error_code
           ) VALUES (?, 'interessenten_details', 'succeeded', ?, ?, 2, 2, 0, NULL)`
        )
        .bind(runId, observedAt, observedAt),
      env.DB
        .prepare(
          `INSERT INTO matool_snapshots (
             area, source_id, first_seen_at, last_seen_at, content_hash,
             payload_json, last_run_id, public_id, last_changed_at
           ) VALUES ('interessenten_details', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          sourceId,
          observedAt,
          observedAt,
          firstHash,
          JSON.stringify(payload),
          runId,
          crypto.randomUUID().replaceAll("-", ""),
          observedAt
        ),
      env.DB
        .prepare(
          `INSERT INTO matool_snapshots (
             area, source_id, first_seen_at, last_seen_at, content_hash,
             payload_json, last_run_id, public_id, last_changed_at
           ) VALUES ('interessenten_details', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          secondSourceId,
          "2026-08-10T12:00:00.000Z",
          "2026-08-10T15:00:00.000Z",
          unchangedHash,
          JSON.stringify(payload),
          runId,
          crypto.randomUUID().replaceAll("-", ""),
          "2026-08-10T12:00:00.000Z"
        )
    ]);

    const firstResponse = await dispatch(
      serviceRequest(
        "/api/zapier/v1/snapshots?area=interessenten_details&limit=300"
      )
    );
    const firstPayload = (await firstResponse.json()) as {
      records: Array<Record<string, unknown>>;
    };
    const firstRecord = firstPayload.records.find(
      (record) => record.source_id === sourceId
    );
    const unchangedRecord = firstPayload.records.find(
      (record) => record.source_id === secondSourceId
    );
    expect(firstResponse.status).toBe(200);
    expect(firstRecord).toMatchObject({
      id: `interessenten_details:${sourceId}:${firstHash.slice(0, 16)}`,
      area: "interessenten_details",
      source_id: sourceId,
      matool_id: sourceId,
      content_hash: firstHash,
      first_seen_at: observedAt,
      last_changed_at: observedAt,
      last_seen_at: observedAt,
      is_new: true,
      vorname: "Beispiel"
    });
    expect(unchangedRecord).toMatchObject({
      id: `interessenten_details:${secondSourceId}:${unchangedHash.slice(0, 16)}`,
      source_id: secondSourceId,
      first_seen_at: "2026-08-10T12:00:00.000Z",
      last_changed_at: "2026-08-10T12:00:00.000Z",
      last_seen_at: "2026-08-10T15:00:00.000Z",
      is_new: true
    });
    expect(
      firstPayload.records.findIndex((record) => record.source_id === sourceId)
    ).toBeLessThan(
      firstPayload.records.findIndex(
        (record) => record.source_id === secondSourceId
      )
    );

    const initiallyChangedResponse = await dispatch(
      serviceRequest(
        "/api/zapier/v1/snapshots?area=interessenten_details&limit=300&only_changed=true"
      )
    );
    const initiallyChangedPayload = (await initiallyChangedResponse.json()) as {
      records: Array<Record<string, unknown>>;
    };
    expect(initiallyChangedPayload.records).not.toContainEqual(
      expect.objectContaining({ source_id: sourceId })
    );
    expect(initiallyChangedPayload.records).not.toContainEqual(
      expect.objectContaining({ source_id: secondSourceId })
    );

    const changedAt = "2026-08-10T14:00:00.000Z";
    const secondHash = "b".repeat(64);
    await env.DB
      .prepare(
        `UPDATE matool_snapshots
         SET content_hash = ?, payload_json = ?, last_seen_at = ?,
             last_changed_at = ?
         WHERE area = 'interessenten_details' AND source_id = ?`
      )
      .bind(
        secondHash,
        JSON.stringify({ ...payload, vorname: "Geändert" }),
        changedAt,
        changedAt,
        sourceId
      )
      .run();

    const changedResponse = await dispatch(
      serviceRequest(
        "/api/zapier/v1/snapshots?area=interessenten_details&limit=300"
      )
    );
    const changedPayload = (await changedResponse.json()) as {
      records: Array<Record<string, unknown>>;
    };
    const changedRecord = changedPayload.records.find(
      (record) => record.source_id === sourceId
    );
    expect(changedResponse.status).toBe(200);
    expect(changedRecord).toMatchObject({
      id: `interessenten_details:${sourceId}:${secondHash.slice(0, 16)}`,
      area: "interessenten_details",
      source_id: sourceId,
      matool_id: sourceId,
      content_hash: secondHash,
      first_seen_at: observedAt,
      last_changed_at: changedAt,
      last_seen_at: changedAt,
      is_new: false,
      vorname: "Geändert"
    });
    expect(changedRecord?.id).not.toBe(firstRecord?.id);

    const onlyChangedResponse = await dispatch(
      serviceRequest(
        "/api/zapier/v1/snapshots?area=interessenten_details&limit=300&only_changed=true"
      )
    );
    const onlyChangedPayload = (await onlyChangedResponse.json()) as {
      records: Array<Record<string, unknown>>;
    };
    expect(onlyChangedPayload.records).toContainEqual(changedRecord);
    expect(onlyChangedPayload.records).not.toContainEqual(
      expect.objectContaining({ source_id: secondSourceId })
    );
  });
});
