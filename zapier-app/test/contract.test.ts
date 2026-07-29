import { describe, expect, it } from "vitest";
import type {
  Bundle,
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import { perform as confirmContactResult } from "../src/creates/confirm-contact-result.js";
import {
  FIRST_TRIAL_EVENT_TYPE,
  SYNTHETIC_CLAIM_ID,
  SYNTHETIC_EVENT_ID
} from "../src/constants.js";
import {
  performList,
  performSubscribe
} from "../src/triggers/first-trial-contact.js";

function capturingZObject(
  responseData: Record<string, unknown>,
  capture: (request: HttpRequestOptionsWithUrl) => void,
  status = 200
): ZObject {
  return {
    request: async (
      request: HttpRequestOptionsWithUrl
    ) => {
      capture(request);
      return {
        data: responseData,
        status,
        throwForStatus: () => {
          if (status >= 400) {
            throw new Error(`HTTP ${status}`);
          }
        }
      };
    },
    errors: {
      Error,
      ThrottledError: Error
    }
  } as unknown as ZObject;
}

describe("Zapier-Middleware-Vertrag", () => {
  it("registriert beim Subscribe ausschließlich Ereignistyp und Zapier-Ziel", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const subscription = {
      id: "zsub_synthetic",
      event_type: FIRST_TRIAL_EVENT_TYPE,
      schema_version: 1
    };
    const bundle = {
      authData: {},
      targetUrl: [
        "https://hooks.",
        "zapier.com/synthetic/target"
      ].join("")
    } as unknown as Bundle;

    await expect(
      performSubscribe(
        capturingZObject(
          subscription,
          (request) => {
            captured = request;
          },
          201
        ),
        bundle
      )
    ).resolves.toEqual(subscription);

    expect(captured).toMatchObject({
      method: "POST",
      url: "https://middleware.example.invalid/api/zapier/v1/subscriptions",
      body: {
        event_type: FIRST_TRIAL_EVENT_TYPE,
        target_url: bundle.targetUrl
      }
    });
    expect(JSON.stringify(captured?.body)).not.toContain("email");
    expect(JSON.stringify(captured?.body)).not.toContain("phone");
  });

  it("meldet das technische Kontaktergebnis mit Event- und Claim-ID", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const eventId = "a".repeat(64);
    const claimId = `zclaim_${"b".repeat(36)}`;
    const bundle = {
      authData: {},
      inputData: {
        event_id: eventId,
        claim_id: claimId,
        outcome: "failed",
        failure_code: "provider_timeout"
      }
    } as unknown as Parameters<typeof confirmContactResult>[1];

    await expect(
      confirmContactResult(
        capturingZObject(
          { confirmed: true, state: "confirmed" },
          (request) => {
            captured = request;
          }
        ),
        bundle
      )
    ).resolves.toEqual({
      id: eventId,
      event_id: eventId,
      confirmed: true,
      state: "confirmed"
    });

    expect(captured).toMatchObject({
      method: "POST",
      url: "https://middleware.example.invalid/api/zapier/v1/events/confirm",
      body: {
        event_id: eventId,
        claim_id: claimId,
        outcome: "failed",
        failure_code: "provider_timeout"
      }
    });
  });

  it("behandelt confirmed:false nicht als erfolgreiche Ergebnisaktion", async () => {
    const bundle = {
      authData: {},
      inputData: {
        event_id: "a".repeat(64),
        claim_id: `zclaim_${"b".repeat(36)}`,
        outcome: "succeeded"
      }
    } as unknown as Parameters<typeof confirmContactResult>[1];

    await expect(
      confirmContactResult(
        capturingZObject(
          { confirmed: false, state: "not_claimable" },
          () => undefined
        ),
        bundle
      )
    ).rejects.toThrow(/nicht bestätigt/u);
  });

  it("holt Editor-Beispiele nur über den synthetischen Sample-Endpunkt", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const events = [
      {
        id: SYNTHETIC_EVENT_ID,
        event_id: SYNTHETIC_EVENT_ID,
        event_type: FIRST_TRIAL_EVENT_TYPE,
        claim_id: SYNTHETIC_CLAIM_ID
      }
    ];
    const bundle = {
      authData: {}
    } as unknown as Bundle;

    await expect(
      performList(
        capturingZObject(
          { events },
          (request) => {
            captured = request;
          }
        ),
        bundle
      )
    ).resolves.toEqual(events);

    expect(captured).toMatchObject({
      method: "POST",
      url: "https://middleware.example.invalid/api/zapier/v1/events/sample",
      body: {
        event_type: FIRST_TRIAL_EVENT_TYPE
      }
    });
    expect(events[0]?.event_id).toMatch(/^[a-f0-9]{64}$/u);
    expect(events[0]?.claim_id).toMatch(/^zclaim_[a-f0-9-]{36}$/u);
  });
});
