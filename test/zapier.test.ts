import { describe, expect, it } from "vitest";

import {
  buildProspectContactEvent,
  FIRST_TRIAL_EVENT_TYPE,
  type FirstTrialPolicy,
  type ProspectFirstTrial
} from "../src/core/first-trial";
import {
  deliverToZapier,
  validateZapierTargetUrl,
  type ZapierDeliveryEnvelope
} from "../src/sinks/zapier";

const record: ProspectFirstTrial = {
  prospectId: "synthetic-prospect-20",
  trialAppointmentId: "synthetic-appointment-20",
  firstTrialStartsAt: "2026-08-04T16:00:00.000Z",
  firstName: "Noa",
  email: "noa@example.invalid",
  phone: null,
  locationCode: "synthetic-location"
};

const policy: FirstTrialPolicy = {
  contactChannel: "email",
  contactLeadMinutes: 1440,
  lookbackMinutes: 120
};

const syntheticHookUrl = [
  "https://hooks.",
  "zapier.com",
  "/hooks/standard/synthetic/path"
].join("");

describe("Zapier-Ausgabeadapter", () => {
  it("erlaubt nur echte Zapier-Hook-Adressen ohne Queryparameter", () => {
    expect(validateZapierTargetUrl(syntheticHookUrl).hostname).toBe(
      "hooks.zapier.com"
    );
    expect(() =>
      validateZapierTargetUrl(
        "https://hooks.zapier.com.attacker.invalid/hooks/standard/a/b"
      )
    ).toThrow();
    expect(() =>
      validateZapierTargetUrl(`${syntheticHookUrl}?secret=leak`)
    ).toThrow();
  });

  it("sendet nur einen signierten Umschlag ohne Personendaten", async () => {
    const event = await buildProspectContactEvent(
      record,
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );
    const envelope: ZapierDeliveryEnvelope = {
      deliveryId: "zdelivery_synthetic-20",
      deliveryToken: "A".repeat(43),
      eventId: event.eventId,
      eventType: event.eventType,
      schemaVersion: 1
    };
    let capturedInit: RequestInit | undefined;
    const syntheticFetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await deliverToZapier(
      envelope,
      {
        enabled: true,
        signingSecret: "synthetic-signing-secret-for-tests",
        targetUrl: syntheticHookUrl
      },
      syntheticFetch
    );

    expect(result).toEqual({ outcome: "accepted", httpStatus: 200 });
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.body).toEqual(expect.any(String));
    const body = JSON.parse(String(capturedInit?.body)) as {
      delivery_id: string;
      delivery_token: string;
      event_id: string;
      event_type: string;
      schema_version: number;
    };
    expect(Array.isArray(body)).toBe(false);
    expect(body.event_id).toBe(event.eventId);
    expect(body.delivery_id).toBe(envelope.deliveryId);
    expect(body.delivery_token).toBe(envelope.deliveryToken);
    expect(body.event_type).toBe(event.eventType);
    expect(body.schema_version).toBe(1);
    expect(String(capturedInit?.body)).not.toContain(record.firstName);
    expect(String(capturedInit?.body)).not.toContain(record.email);
    expect(new Headers(capturedInit?.headers).get("X-Matool-Signature")).toMatch(
      /^v1=/
    );
  });

  it("ordnet 429 als sicheren Retry ein", async () => {
    const event = await buildProspectContactEvent(
      record,
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );
    const envelope: ZapierDeliveryEnvelope = {
      deliveryId: "zdelivery_synthetic-20",
      deliveryToken: "B".repeat(43),
      eventId: event.eventId,
      eventType: event.eventType,
      schemaVersion: 1
    };
    const result = await deliverToZapier(
      envelope,
      {
        enabled: true,
        signingSecret: "synthetic-signing-secret-for-tests",
        targetUrl: syntheticHookUrl
      },
      (async () => new Response(null, { status: 429 })) as typeof fetch
    );

    expect(result.outcome).toBe("retryable_error");
  });

  it("klassifiziert eine entfernte Subscription dauerhaft", async () => {
    const result = await deliverToZapier(
      {
        deliveryId: "zdelivery_synthetic-410",
        deliveryToken: "C".repeat(43),
        eventId: "a".repeat(64),
        eventType: FIRST_TRIAL_EVENT_TYPE,
        schemaVersion: 1
      },
      {
        enabled: true,
        signingSecret: "synthetic-signing-secret-for-tests",
        targetUrl: syntheticHookUrl
      },
      (async () => new Response(null, { status: 410 })) as typeof fetch
    );

    expect(result).toEqual({
      outcome: "permanent_error",
      httpStatus: 410,
      errorCode: "zapier_subscription_gone"
    });
  });
});
