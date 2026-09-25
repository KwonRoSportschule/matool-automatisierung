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
import { storedPayloadCipher } from "../src/worker/payload-encryption";
import { MATOOL_SNAPSHOT_AREAS } from "../src/worker/schedule";

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
  onlyChanged = false,
  onlyNew = false
): Promise<string> {
  // Ein Erstimport wird nie zugestellt. Die Tests pruefen den laufenden
  // Betrieb: Der Bereich hat bereits einen Bestand, bevor das Abo entsteht.
  await ensureAreaBaseline(area);
  const response = await dispatch(
    serviceRequest("/api/zapier/v1/snapshot-subscriptions", {
      body: JSON.stringify({
        area,
        only_changed: onlyChanged,
        only_new: onlyNew,
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

async function ensureAreaBaseline(area: string): Promise<void> {
  const present = await env.DB.prepare(
    "SELECT 1 AS present FROM matool_snapshots WHERE area = ? LIMIT 1"
  )
    .bind(area)
    .first();
  if (!present) {
    await persistChange(area, "999999", "bestand");
  }
}

async function persistChange(
  area: string,
  sourceId: string,
  value: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  await persistMatoolSnapshotRun(
    env.DB,
    {
      allowedPayloadFields: ["value"],
      area,
      finishedAt: timestamp,
      observedAt: timestamp,
      records: [{ sourceId, payload: { value } }],
      runId: `snapshot_${area}_${crypto.randomUUID()}`,
      startedAt: timestamp
    },
    await storedPayloadCipher(env)
  );
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

  it("stellt bei only_new nur den ersten Datensatz eines Mitglieds zu", async () => {
    const targetUrl = zapierTargetUrl();
    const subscriptionId = await subscribe(
      "schueler_details",
      targetUrl,
      false,
      true
    );
    const sourceId = crypto.randomUUID().replaceAll("-", "");
    await persistChange("schueler_details", sourceId, "neu");
    await persistChange("schueler_details", sourceId, "geändert");

    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const result = await processSnapshotZapierDeliveries(
      deliveryEnv(),
      fetchImplementation
    );

    expect(result).toMatchObject({ completed: 1, processed: 1 });
    expect(requests).toHaveLength(1);
    await expect(requests[0]?.json()).resolves.toMatchObject({
      change_kind: "created",
      is_new: true,
      source_id: sourceId
    });

    await dispatch(
      serviceRequest(
        `/api/zapier/v1/snapshot-subscriptions/${subscriptionId}`,
        { method: "DELETE" }
      )
    );
  });

  it("liefert Mitglieder-Details ohne Bank- und Zahlungsdaten an Zapier", async () => {
    const targetUrl = zapierTargetUrl();
    await subscribe("schueler_details", targetUrl);
    const timestamp = new Date().toISOString();
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: [
        "bic",
        "beitrag",
        "email",
        "iban",
        "konto",
        "name",
        "schueler_nr",
        "vertragid",
        "vertragsende",
        "vname",
        "zahlart"
      ],
      area: "schueler_details",
      finishedAt: timestamp,
      observedAt: timestamp,
      records: [
        {
          sourceId: "987654",
          payload: {
            bic: "SYNTHETICBIC",
            beitrag: "79.00",
            email: "mitglied@example.invalid",
            iban: "DE00123456780000000000",
            konto: "12345678",
            name: "Mitglied",
            schueler_nr: "987654",
            vertragid: "synthetic-contract-id",
            vertragsende: "2027-08-01",
            vname: "Beispiel",
            zahlart: "SEPA"
          }
        }
      ],
      runId: `snapshot_schueler_details_${crypto.randomUUID()}`,
      startedAt: timestamp
    }, await storedPayloadCipher(env));

    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await processSnapshotZapierDeliveries(deliveryEnv(), fetchImplementation);

    expect(requests).toHaveLength(1);
    const delivered = (await requests[0]?.json()) as Record<string, unknown>;
    expect(delivered).toMatchObject({
      area: "schueler_details",
      email: "mitglied@example.invalid",
      name: "Mitglied",
      schueler_nr: "987654",
      vertragid: "synthetic-contract-id",
      vertragsende: "2027-08-01",
      vname: "Beispiel"
    });
    for (const field of ["iban", "bic", "konto", "beitrag", "zahlart"]) {
      expect(delivered).not.toHaveProperty(field);
    }
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

  it("stellt nach dem Einschalten keine Aenderungen vor dem Startzeitpunkt zu", async () => {
    const targetUrl = zapierTargetUrl();
    await subscribe("interessenten_details", targetUrl);
    const sourceId = crypto.randomUUID().replaceAll("-", "");
    // Rueckstau aus der Zeit, in der die Zustellung aus war.
    await persistChange("interessenten_details", sourceId, "alt");

    const start = new Date(Date.now() + 60_000);
    const later = new Date(start.getTime() + 60_000).toISOString();
    await persistMatoolSnapshotRun(
      env.DB,
      {
        allowedPayloadFields: ["value"],
        area: "interessenten_details",
        finishedAt: later,
        observedAt: later,
        records: [{ sourceId, payload: { value: "neu" } }],
        runId: `snapshot_start_${crypto.randomUUID()}`,
        startedAt: later
      },
      await storedPayloadCipher(env)
    );

    const bodies: unknown[] = [];
    const fetchImplementation = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const request = new Request(input, init);
      if (request.url === targetUrl) {
        bodies.push(await request.json());
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const startedEnv = {
      ...deliveryEnv(),
      OUTBOUND_DELIVERY_START_AT: start.toISOString()
    } as Env;

    await processSnapshotZapierDeliveries(startedEnv, fetchImplementation);
    await processSnapshotZapierDeliveries(startedEnv, fetchImplementation);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      area: "interessenten_details",
      change_kind: "updated",
      source_id: sourceId,
      value: "neu"
    });
  });

  it("stellt bei ungueltigem Startzeitpunkt gar nichts zu", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(null, { status: 204 })
    ) as unknown as typeof fetch;
    await expect(
      processSnapshotZapierDeliveries(
        { ...deliveryEnv(), OUTBOUND_DELIVERY_START_AT: "morgen" } as Env,
        fetchImplementation
      )
    ).rejects.toMatchObject({ code: "outbound_delivery_start_invalid" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("gibt Mitglieder-Details an Zapier nur ohne Bank-, Zahlungs- und Geburtsdaten heraus", async () => {
    const subscription = await dispatch(
      serviceRequest("/api/zapier/v1/snapshot-subscriptions", {
        body: JSON.stringify({
          area: "schueler_details",
          only_changed: false,
          target_url: zapierTargetUrl()
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    );
    expect(subscription.status).toBe(201);

    const timestamp = new Date().toISOString();
    const sentinel = `SENTINEL${crypto.randomUUID().replaceAll("-", "")}`;
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: [
        "bank",
        "geburtstag",
        "iban",
        "kontoinhaber",
        "mandatsreferenz",
        "schueler_nr",
        "strasse",
        "vname"
      ],
      area: "schueler_details",
      finishedAt: timestamp,
      observedAt: timestamp,
      records: [
        {
          sourceId: "987655",
          payload: {
            bank: `${sentinel}-bank`,
            geburtstag: `${sentinel}-geburtstag`,
            iban: `${sentinel}-iban`,
            kontoinhaber: `${sentinel}-inhaber`,
            mandatsreferenz: `${sentinel}-mandat`,
            schueler_nr: "987655",
            strasse: `${sentinel}-strasse`,
            vname: "Beispiel"
          }
        }
      ],
      runId: `snapshot_schueler_details_${crypto.randomUUID()}`,
      startedAt: timestamp
    }, await storedPayloadCipher(env));

    const feed = await dispatch(
      serviceRequest("/api/zapier/v1/snapshots?area=schueler_details&limit=300")
    );
    expect(feed.status).toBe(200);
    const serialized = await feed.text();
    expect(serialized).toContain("987655");
    expect(serialized).not.toContain(sentinel);

    const account = await dispatch(serviceRequest("/api/zapier/v1/account"));
    await expect(account.json()).resolves.toMatchObject({
      snapshot_areas: [...MATOOL_SNAPSHOT_AREAS]
    });
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
