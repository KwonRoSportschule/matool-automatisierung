import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { FIRST_TRIAL_EVENT_TYPE } from "../src/constants.js";
import {
  verifyWebhookRequest,
  type DeliveryEnvelope
} from "../src/webhook-security.js";

const signingSecret = "synthetic-webhook-signing-secret";
const now = new Date("2026-08-03T16:30:00.000Z");
const timestamp = Math.floor(now.getTime() / 1000).toString();

const envelope: DeliveryEnvelope = {
  delivery_id: "zout:synthetic:1",
  delivery_token: "a".repeat(43),
  event_id: "a".repeat(64),
  event_type: FIRST_TRIAL_EVENT_TYPE,
  schema_version: 1
};

function rawRequest(
  body: string,
  timestampValue = timestamp,
  secret = signingSecret,
  headerVariant: "direct" | "http-prefixed" = "http-prefixed"
): {
  content: string;
  headers: Record<string, string>;
  method: "POST";
} {
  const signature = createHmac("sha256", secret)
    .update(`${timestampValue}.${body}`)
    .digest("base64url");
  const prefix =
    headerVariant === "http-prefixed" ? "Http-" : "";
  return {
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      [`${prefix}X-Matool-Timestamp`]: timestampValue,
      [`${prefix}X-Matool-Signature`]: `v1=${signature}`
    },
    content: body
  };
}

describe("Webhook-Sicherheitsgrenze", () => {
  it("akzeptiert Zapier-kompatible Http-X-Matool-Header", () => {
    const body = JSON.stringify(envelope);
    expect(
      verifyWebhookRequest(rawRequest(body), signingSecret, now)
    ).toEqual(envelope);
  });

  it("akzeptiert ursprüngliche X-Matool-Header unabhängig von Großschreibung", () => {
    const body = JSON.stringify(envelope);
    const request = rawRequest(
      body,
      timestamp,
      signingSecret,
      "direct"
    );
    request.headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name.toLowerCase(),
        value
      ])
    );

    expect(
      verifyWebhookRequest(request, signingSecret, now)
    ).toEqual(envelope);
  });

  it("verwirft widersprüchliche direkte und Http-präfixierte Header", () => {
    const body = JSON.stringify(envelope);
    const request = rawRequest(body);
    request.headers["X-Matool-Timestamp"] = (
      Number.parseInt(timestamp, 10) - 1
    ).toString();
    request.headers["X-Matool-Signature"] =
      request.headers["Http-X-Matool-Signature"] ?? "";

    expect(() =>
      verifyWebhookRequest(request, signingSecret, now)
    ).toThrow(/ungültig/u);
  });

  it("verwirft jede Manipulation des signierten Bodys", () => {
    const originalBody = JSON.stringify(envelope);
    const changedBody = JSON.stringify({
      ...envelope,
      delivery_id: "zout:changed:1"
    });
    const signedOriginal = rawRequest(originalBody);
    expect(() =>
      verifyWebhookRequest(
        { ...signedOriginal, content: changedBody },
        signingSecret,
        now
      )
    ).toThrow(/ungültig/u);
  });

  it("verwirft abgelaufene Zustellungen", () => {
    const body = JSON.stringify(envelope);
    const staleTimestamp = Math.floor(
      now.getTime() / 1000 - 301
    ).toString();
    expect(() =>
      verifyWebhookRequest(
        rawRequest(body, staleTimestamp),
        signingSecret,
        now
      )
    ).toThrow(/ungültig/u);
  });

  it("enthält im Umschlag keine Kontaktdaten", () => {
    const body = JSON.stringify(envelope);
    expect(body).not.toContain("email");
    expect(body).not.toContain("phone");
    expect(body).not.toContain("first_name");
  });

  it("verwirft signierte Umschläge mit zusätzlichen Feldern", () => {
    const body = JSON.stringify({
      ...envelope,
      email: "nicht-im-hook@example.invalid"
    });

    expect(() =>
      verifyWebhookRequest(rawRequest(body), signingSecret, now)
    ).toThrow(/ungültig/u);
  });
});
