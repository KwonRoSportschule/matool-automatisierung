import { describe, expect, it } from "vitest";

import {
  buildProspectContactEvent,
  type FirstTrialPolicy,
  type ProspectFirstTrial
} from "../src/core/first-trial";
import {
  deliverToZapier,
  validateZapierHookUrl
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
  "/hooks/catch/synthetic/path"
].join("");

describe("Zapier-Ausgabeadapter", () => {
  it("erlaubt nur echte Catch-Hook-Adressen", () => {
    expect(validateZapierHookUrl(syntheticHookUrl).hostname).toBe(
      "hooks.zapier.com"
    );
    expect(() =>
      validateZapierHookUrl(
        "https://hooks.zapier.com.attacker.invalid/hooks/catch/a/b"
      )
    ).toThrow();
  });

  it("sendet genau ein signiertes JSON-Objekt mit Ereignis-ID", async () => {
    const event = await buildProspectContactEvent(
      record,
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );
    let capturedInit: RequestInit | undefined;
    const syntheticFetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const result = await deliverToZapier(
      event,
      {
        catchHookUrl: syntheticHookUrl,
        enabled: true,
        signingSecret: "synthetic-signing-secret-for-tests"
      },
      syntheticFetch
    );

    expect(result).toEqual({ outcome: "accepted", httpStatus: 200 });
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.body).toEqual(expect.any(String));
    const body = JSON.parse(String(capturedInit?.body)) as {
      event_id: string;
    };
    expect(Array.isArray(body)).toBe(false);
    expect(body.event_id).toBe(event.eventId);
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
    const result = await deliverToZapier(
      event,
      {
        catchHookUrl: syntheticHookUrl,
        enabled: true,
        signingSecret: "synthetic-signing-secret-for-tests"
      },
      (async () => new Response(null, { status: 429 })) as typeof fetch
    );

    expect(result.outcome).toBe("retryable_error");
  });
});
