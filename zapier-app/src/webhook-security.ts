import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

import type { Bundle } from "zapier-platform-core";

import { FIRST_TRIAL_EVENT_TYPE } from "./constants.js";

const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_WEBHOOK_BYTES = 8_192;

export interface DeliveryEnvelope {
  delivery_id: string;
  delivery_token: string;
  event_id: string;
  event_type: typeof FIRST_TRIAL_EVENT_TYPE;
  schema_version: 1;
}

export function verifyWebhookRequest(
  rawRequest: Bundle["rawRequest"],
  signingSecret: string,
  now: Date = new Date()
): DeliveryEnvelope {
  if (signingSecret.length < 24 || !rawRequest?.headers) {
    throw invalidWebhook();
  }

  const contentType = aliasedHeader(
    rawRequest.headers,
    ["Content-Type"]
  );
  const timestampHeader = aliasedHeader(
    rawRequest.headers,
    ["X-Matool-Timestamp", "Http-X-Matool-Timestamp"]
  );
  const signatureHeader = aliasedHeader(
    rawRequest.headers,
    ["X-Matool-Signature", "Http-X-Matool-Signature"]
  );
  const body = rawRequest.content ?? "";

  if (
    !contentType.toLowerCase().startsWith("application/json") ||
    new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BYTES ||
    !/^\d{10}$/u.test(timestampHeader) ||
    !signatureHeader.startsWith("v1=")
  ) {
    throw invalidWebhook();
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (
    Math.abs(Math.floor(now.getTime() / 1000) - timestamp) >
    MAX_CLOCK_SKEW_SECONDS
  ) {
    throw invalidWebhook();
  }

  const expected = createHmac("sha256", signingSecret)
    .update(`${timestampHeader}.${body}`)
    .digest("base64url");
  const supplied = signatureHeader.slice(3);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    throw invalidWebhook();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw invalidWebhook();
  }
  if (!isDeliveryEnvelope(parsed)) {
    throw invalidWebhook();
  }
  return parsed;
}

function aliasedHeader(
  headers: Record<string, string>,
  expectedNames: readonly string[]
): string {
  const aliases = new Set(
    expectedNames.map((name) => name.toLowerCase())
  );
  const values = Object.entries(headers)
    .filter(([name]) => aliases.has(name.toLowerCase()))
    .map(([, value]) => value.trim());

  if (
    values.length === 0 ||
    values.some((value) => value.length === 0) ||
    values.some((value) => value !== values[0])
  ) {
    return "";
  }
  return values[0] ?? "";
}

function isDeliveryEnvelope(value: unknown): value is DeliveryEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  if (
    keys.join(",") !==
    [
      "delivery_id",
      "delivery_token",
      "event_id",
      "event_type",
      "schema_version"
    ].join(",")
  ) {
    return false;
  }
  const envelope = value as Partial<DeliveryEnvelope>;
  return (
    envelope.schema_version === 1 &&
    envelope.event_type === FIRST_TRIAL_EVENT_TYPE &&
    typeof envelope.event_id === "string" &&
    /^[a-f0-9]{64}$/u.test(envelope.event_id) &&
    typeof envelope.delivery_id === "string" &&
    /^[A-Za-z0-9:_-]{10,240}$/u.test(envelope.delivery_id) &&
    typeof envelope.delivery_token === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(envelope.delivery_token)
  );
}

function invalidWebhook(): Error {
  return new Error("Die Webhook-Signatur oder Nutzlast ist ungültig.");
}
