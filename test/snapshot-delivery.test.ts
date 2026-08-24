import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import {
  processSnapshotZapierDeliveries,
  type SnapshotDeliverySummary
} from "../src/worker/snapshot-delivery";
import type { Env } from "../src/worker/env";
import worker from "../src/worker";

const serviceToken =
  "synthetic-service-token-at-least-32-characters";

function zapierTargetUrl(): string {
  return [
    "https://hooks.",
    "zapier.com/hooks/standard/",
    crypto.randomUUID()
  ].join("");
}

async function dispatch(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

function serviceRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serviceToken}`);
  return new Request(`https://middleware.example.invalid${path}`, {
    ...init,
    headers
  });
}

async function subscribe(
  area: string,
  targetUrl: string,
  onlyChanged = false
): Promise<string> {
  const response = await dispatch(
    serviceRequest("/api/zapier/v1/snapshot-subscriptions", {
      body: JSON.stringify({
        area,
        only_changed: onlyChanged,
        target_url: targetUrl
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    })
  );
  const payload = (await response.json()) as { id: string };
  expect(response.status).toBe(201);
  expect(payload.id).toMatch(/^zsnap_[a-f0-9-]{36}$/u);
  return payload.id;
}

async function persistChange(
  area: string,
  sourceId: string,
  value: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  await persistMatoolSnapshotRun(env.DB, {
    allowedPayloadFields: ["value"],
    area,
    finishedAt: timestamp,
    observedAt: timestamp,
    records: [{ sourceId, payload: { value } }],
    runId: `snapshot_${area}_${crypto.randomUUID()}`,
    startedAt: timestamp
  });
}

function deliveryEnv(): Env {
  return {
    ...env,
    OUTBOUND_DELIVERY_ENABLED: "true"
  } as Env;
}

describe("Zapier-Snapshot-Hook-Zustellung", () => {
  it("schuetzt die Subscription-API und akzeptiert nur ein striktes Zapier-HTTPS-Ziel", async () => {
    const unauthorized = await dispatch(
      new Request(
        "https://middleware.example.invalid/api/zapier/v1/snapshot-subscriptions",
        {
          body: JSON.stringify({
            area: "interessenten",
            only_changed: false,
            target_url: zapierTargetUrl()
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }
      )
    );
    expect(unauthorized.status).toBe(403);

    const invalidTarget = await dispatch(
      serviceRequest("/api/zapier/v1/snapshot-subscriptions", {
        body: JSON.stringify({
          area: "interessenten",
          only_changed: false,
          target_url:
            "https://hooks.zapier.com.attacker.invalid/hooks/standard/x"
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    );
    expect(invalidTarget.status).toBe(400);

    const subscriptionId = await subscribe("interessenten", zapierTargetUrl());
    const disabled = await dispatch(
      serviceRequest(
        `/api/zapier/v1/snapshot-subscriptions/${subscriptionId}`,
        { method: "DELETE" }
      )
    );
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      disabled: true,
      id: subscriptionId
    });
  });

  it("sendet jedes unveraenderliche Ereignis einzeln und rueckt erst nach 2xx weiter", async () => {
    const targetUrl = zapierTargetUrl();
    await subscribe("interessenten", targetUrl);
    const sourceId = crypto.randomUUID().replaceAll("-", "");
    await persistChange("interessenten", sourceId, "A");

    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const first = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      fetchImplementation
    );
    expect(first).toEqual<SnapshotDeliverySummary>({
      completed: 1,
      disabled: 0,
      processed: 1,
      retried: 0
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(targetUrl);
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toMatchObject({
      area: "interessenten",
      change_kind: "created",
      content_hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      is_new: true,
      source_id: sourceId,
      value: "A",
      zapier_event_id: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });

    const second = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      fetchImplementation
    );
    expect(second.processed).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["429", async () => new Response(null, { status: 429 })],
    ["5xx", async () => new Response(null, { status: 503 })],
    ["Netzfehler", async () => Promise.reject(new Error("offline"))]
  ])("plant bei %s einen verlustfreien Retry", async (_label, response) => {
    await subscribe("schueler", zapierTargetUrl());
    await persistChange(
      "schueler",
      crypto.randomUUID().replaceAll("-", ""),
      "retry"
    );
    const fetchImplementation = vi.fn(response) as unknown as typeof fetch;

    const result = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      fetchImplementation
    );

    expect(result).toMatchObject({
      completed: 0,
      disabled: 0,
      processed: 1,
      retried: 1
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("deaktiviert eine mit 410 entfernte Subscription dauerhaft", async () => {
    await subscribe("schueler", zapierTargetUrl());
    const sourceId = crypto.randomUUID().replaceAll("-", "");
    await persistChange("schueler", sourceId, "gone");
    const goneFetch = vi.fn(
      async () => new Response(null, { status: 410 })
    ) as unknown as typeof fetch;

    const gone = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      goneFetch
    );
    expect(gone).toMatchObject({ disabled: 1, processed: 1 });

    await persistChange("schueler", sourceId, "after-gone");
    const unexpectedFetch = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch;
    const afterGone = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      unexpectedFetch
    );
    expect(afterGone.processed).toBe(0);
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  it("bleibt bei deaktivierter Ausgangszustellung ohne Netzwerkzugriff", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch;
    const result = await processSnapshotZapierDeliveries(
      { ...env, OUTBOUND_DELIVERY_ENABLED: "false" } as Env,
      fetchImplementation
    );

    expect(result.processed).toBe(0);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
