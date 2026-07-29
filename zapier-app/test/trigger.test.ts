import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { Bundle, ZObject } from "zapier-platform-core";

import { FIRST_TRIAL_EVENT_TYPE } from "../src/constants.js";
import {
  perform,
  performUnsubscribe
} from "../src/triggers/first-trial-contact.js";

const secret = "synthetic-webhook-signing-secret";
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({
  delivery_id: "zout:synthetic:1",
  delivery_token: "a".repeat(43),
  event_id: "a".repeat(64),
  event_type: FIRST_TRIAL_EVENT_TYPE,
  schema_version: 1
});
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${body}`)
  .digest("base64url");

function bundle(): Bundle {
  return {
    authData: {
      webhook_signing_secret: secret
    },
    rawRequest: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Http-X-Matool-Timestamp": timestamp,
        "Http-X-Matool-Signature": `v1=${signature}`
      },
      content: body
    }
  } as unknown as Bundle;
}

function zObject(
  responseData: Record<string, unknown>,
  status = 200
): ZObject {
  return {
    request: async () => ({
      data: responseData,
      status,
      throwForStatus: () => {
        if (status >= 400) {
          throw new Error(`HTTP ${status}`);
        }
      }
    }),
    errors: {
      Error,
      ThrottledError: Error
    }
  } as unknown as ZObject;
}

describe("REST-Hook-Trigger", () => {
  it("gibt nach erfolgreichem Claim genau ein Ereignis aus", async () => {
    const event = {
      id: "a".repeat(64),
      event_id: "a".repeat(64),
      claim_id: "synthetic-claim"
    };
    await expect(
      perform(
        zObject({ claimed: true, state: "claimed", event }),
        bundle()
      )
    ).resolves.toEqual([event]);
  });

  it("startet bei einer doppelten Zustellung keinen zweiten Zap", async () => {
    await expect(
      perform(
        zObject({ claimed: false, state: "already_claimed" }),
        bundle()
      )
    ).resolves.toEqual([]);
  });

  it("wandelt Middleware-Drosselung in einen wiederholbaren Zapier-Fehler um", async () => {
    await expect(
      perform(zObject({}, 429), bundle())
    ).rejects.toThrow(/begrenzt Anfragen/u);
  });

  it("behandelt eine bereits entfernte Subscription idempotent", async () => {
    const unsubscribeBundle = {
      authData: {},
      subscribeData: {
        id: "synthetic-subscription"
      }
    } as unknown as Bundle;

    await expect(
      performUnsubscribe(
        zObject({}, 404),
        unsubscribeBundle
      )
    ).resolves.toEqual({ disabled: true });
  });
});
