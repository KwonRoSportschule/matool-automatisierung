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

interface SeedChange {
  changeKind: "created" | "updated";
  contentHash: string;
  eventId: string;
  observedAt: string;
  payload: Record<string, unknown>;
  sourceId: string;
}

interface ZapierSnapshotPage {
  count: number;
  has_more: boolean;
  next_cursor: string | null;
  records: Array<Record<string, unknown>>;
}

async function seedSnapshotChanges(
  area: string,
  changes: readonly SeedChange[]
): Promise<void> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const rows = changes.map((change, index) => ({
    ...change,
    payloadJson: JSON.stringify(change.payload),
    publicId: crypto.randomUUID().replaceAll("-", ""),
    runId: `zapier_feed_${seed}_${index}`
  }));
  const latestBySource = new Map<
    string,
    (typeof rows)[number] & { firstSeenAt: string }
  >();
  for (const row of rows) {
    const existing = latestBySource.get(row.sourceId);
    latestBySource.set(row.sourceId, {
      ...row,
      firstSeenAt: existing?.firstSeenAt ?? row.observedAt
    });
  }

  await env.DB
    .prepare(
      `INSERT INTO matool_snapshot_runs (
         run_id, area, status, started_at, finished_at,
         fetched_count, success_count, failure_count, error_code
       )
       SELECT json_extract(value, '$.runId'), ?, 'succeeded',
              json_extract(value, '$.observedAt'),
              json_extract(value, '$.observedAt'), 1, 1, 0, NULL
       FROM json_each(?)`
    )
    .bind(area, JSON.stringify(rows))
    .run();

  await env.DB
    .prepare(
      `INSERT INTO matool_snapshots (
         area, source_id, first_seen_at, last_seen_at, content_hash,
         payload_json, last_run_id, public_id, last_changed_at
       )
       SELECT ?,
              json_extract(value, '$.sourceId'),
              json_extract(value, '$.firstSeenAt'),
              json_extract(value, '$.observedAt'),
              json_extract(value, '$.contentHash'),
              json_extract(value, '$.payloadJson'),
              json_extract(value, '$.runId'),
              json_extract(value, '$.publicId'),
              json_extract(value, '$.observedAt')
       FROM json_each(?)`
    )
    .bind(area, JSON.stringify([...latestBySource.values()]))
    .run();

  await env.DB
    .prepare(
      `INSERT INTO matool_snapshot_changes (
         area, source_id, run_id, change_kind, observed_at, content_hash,
         payload_json, zapier_event_id
       )
       SELECT ?,
              json_extract(value, '$.sourceId'),
              json_extract(value, '$.runId'),
              json_extract(value, '$.changeKind'),
              json_extract(value, '$.observedAt'),
              json_extract(value, '$.contentHash'),
              json_extract(value, '$.payloadJson'),
              json_extract(value, '$.eventId')
       FROM json_each(?)`
    )
    .bind(area, JSON.stringify(rows))
    .run();
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

  it("paginiert mehr als 100 Änderungen ohne Überschneidung", async () => {
    const seed = crypto.randomUUID().replaceAll("-", "");
    const changes = Array.from({ length: 105 }, (_, index) => ({
      changeKind: "created" as const,
      contentHash: (index % 16).toString(16).repeat(64),
      eventId: `${seed}${index.toString(16).padStart(32, "0")}`,
      observedAt: new Date(
        Date.UTC(2026, 7, 10, 9, 0, 0) + index * 1_000
      ).toISOString(),
      payload: { sequence: index },
      sourceId: `telemetry-${seed}-${index}`
    }));
    await seedSnapshotChanges("telemetrie", changes);

    const firstResponse = await dispatch(
      serviceRequest("/api/zapier/v1/snapshots?area=telemetrie&limit=100")
    );
    const first = (await firstResponse.json()) as ZapierSnapshotPage;
    expect(firstResponse.status).toBe(200);
    expect(first.records).toHaveLength(100);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).toMatch(/^[1-9]\d*$/u);
    expect(first.records[0]).toMatchObject({ sequence: 104 });

    const secondResponse = await dispatch(
      serviceRequest(
        `/api/zapier/v1/snapshots?area=telemetrie&limit=100&cursor=${first.next_cursor}`
      )
    );
    const second = (await secondResponse.json()) as ZapierSnapshotPage;
    expect(secondResponse.status).toBe(200);
    expect(second.records).toHaveLength(5);
    expect(second.has_more).toBe(false);
    expect(second.next_cursor).toBeNull();
    expect(second.records.at(-1)).toMatchObject({ sequence: 0 });

    const firstIds = new Set(first.records.map(({ id }) => id));
    const allIds = new Set([
      ...first.records.map(({ id }) => id),
      ...second.records.map(({ id }) => id)
    ]);
    expect(second.records.every(({ id }) => !firstIds.has(id))).toBe(true);
    expect(allIds.size).toBe(105);
  });

  it("filtert only_changed vor dem Seitenlimit", async () => {
    const seed = crypto.randomUUID().replaceAll("-", "");
    const targetSourceId = `report-${seed}-target`;
    const changes: SeedChange[] = [
      {
        changeKind: "created",
        contentHash: "a".repeat(64),
        eventId: `${seed}${"1".padStart(32, "0")}`,
        observedAt: "2026-08-10T09:00:00.000Z",
        payload: { version: "initial" },
        sourceId: targetSourceId
      },
      {
        changeKind: "updated",
        contentHash: "b".repeat(64),
        eventId: `${seed}${"2".padStart(32, "0")}`,
        observedAt: "2026-08-10T09:01:00.000Z",
        payload: { version: "changed" },
        sourceId: targetSourceId
      },
      ...Array.from({ length: 105 }, (_, index) => ({
        changeKind: "created" as const,
        contentHash: "c".repeat(64),
        eventId: `${seed}${(index + 3).toString(16).padStart(32, "0")}`,
        observedAt: new Date(
          Date.UTC(2026, 7, 10, 10, 0, 0) + index * 1_000
        ).toISOString(),
        payload: { version: `created-${index}` },
        sourceId: `report-${seed}-${index}`
      }))
    ];
    await seedSnapshotChanges("berichte", changes);

    const response = await dispatch(
      serviceRequest(
        "/api/zapier/v1/snapshots?area=berichte&limit=100&only_changed=true"
      )
    );
    const payload = (await response.json()) as ZapierSnapshotPage;

    expect(response.status).toBe(200);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({
      change_kind: "updated",
      is_new: false,
      source_id: targetSourceId,
      version: "changed"
    });
  });

  it("liefert für A-B-A eigene IDs und den historischen Payload", async () => {
    const seed = crypto.randomUUID().replaceAll("-", "");
    const sourceId = `map-${seed}`;
    const firstId = `${seed}${"1".padStart(32, "0")}`;
    const secondId = `${seed}${"2".padStart(32, "0")}`;
    const thirdId = `${seed}${"3".padStart(32, "0")}`;
    const repeatedHash = "a".repeat(64);
    await seedSnapshotChanges("karte", [
      {
        changeKind: "created",
        contentHash: repeatedHash,
        eventId: firstId,
        observedAt: "2026-08-10T09:00:00.000Z",
        payload: { state: "A-erster-Zustand" },
        sourceId
      },
      {
        changeKind: "updated",
        contentHash: "b".repeat(64),
        eventId: secondId,
        observedAt: "2026-08-10T10:00:00.000Z",
        payload: { state: "B" },
        sourceId
      },
      {
        changeKind: "updated",
        contentHash: repeatedHash,
        eventId: thirdId,
        observedAt: "2026-08-10T11:00:00.000Z",
        payload: {
          id: "payload-id-must-not-win",
          change_kind: "created",
          source_id: "payload-source-must-not-win",
          state: "A-zweiter-Zustand"
        },
        sourceId
      }
    ]);

    const response = await dispatch(
      serviceRequest("/api/zapier/v1/snapshots?area=karte&limit=100")
    );
    const payload = (await response.json()) as ZapierSnapshotPage;

    expect(response.status).toBe(200);
    expect(payload.records.map(({ id }) => id)).toEqual([
      thirdId,
      secondId,
      firstId
    ]);
    expect(payload.records.map(({ state }) => state)).toEqual([
      "A-zweiter-Zustand",
      "B",
      "A-erster-Zustand"
    ]);
    expect(payload.records[0]).toMatchObject({
      change_kind: "updated",
      content_hash: repeatedHash,
      id: thirdId,
      source_id: sourceId,
      zapier_event_id: thirdId
    });
    expect(payload.records[2]).toMatchObject({
      change_kind: "created",
      content_hash: repeatedHash,
      id: firstId,
      zapier_event_id: firstId
    });
  });

  it("weist einen ungültigen Änderungs-Cursor zurück", async () => {
    const response = await dispatch(
      serviceRequest("/api/zapier/v1/snapshots?area=karte&cursor=invalid")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_integration_payload" }
    });
  });
});
