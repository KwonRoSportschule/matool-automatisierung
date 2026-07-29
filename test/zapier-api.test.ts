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
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers
  });
}

describe("Zapier-Service-API", () => {
  it("bleibt zusätzlich hinter Cloudflare Access geschützt", async () => {
    const response = await dispatch(
      new Request("https://example.invalid/api/zapier/v1/account", {
        headers: {
          Authorization: `Bearer ${serviceToken}`
        }
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "access_denied" }
    });
  });

  it("verlangt zusätzlich den eigenen Service-Token", async () => {
    const missing = await dispatch(
      new Request("http://127.0.0.1/api/zapier/v1/account")
    );
    const wrong = await dispatch(
      new Request("http://127.0.0.1/api/zapier/v1/account", {
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
      subscription_limit_per_event_type: 1
    });
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
});
