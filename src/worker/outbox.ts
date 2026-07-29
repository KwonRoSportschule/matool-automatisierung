import { AppError } from "../core/app-error";
import { parseProspectContactEventJson } from "../core/first-trial";
import { deliverToZapier, type SinkResult } from "../sinks/zapier";
import {
  claimNextZapierOutbox,
  failExhaustedUnclaimedZapierOutboxes,
  finalizeZapierOutboxAttempt
} from "./delivery-repository";
import type { Env } from "./env";

const DEFAULT_BATCH_SIZE = 10;
const LEASE_DURATION_SECONDS = 30;
const MAX_ATTEMPTS = 8;

export interface ProcessOutboxOptions {
  fetchImplementation?: typeof fetch;
  maxItems?: number;
  now?: () => Date;
}

export interface ProcessOutboxResult {
  accepted: number;
  awaitingClaims: number;
  disabled: boolean;
  permanentFailures: number;
  processed: number;
  retriesScheduled: number;
}

export async function processZapierOutbox(
  env: Env,
  options: ProcessOutboxOptions = {}
): Promise<ProcessOutboxResult> {
  const summary: ProcessOutboxResult = {
    accepted: 0,
    awaitingClaims: 0,
    disabled: env.OUTBOUND_DELIVERY_ENABLED !== "true",
    permanentFailures: 0,
    processed: 0,
    retriesScheduled: 0
  };

  if (summary.disabled) {
    return summary;
  }

  if (
    !env.ZAPIER_WEBHOOK_SIGNING_SECRET ||
    env.ZAPIER_WEBHOOK_SIGNING_SECRET.length < 24
  ) {
    throw new AppError(
      "zapier_delivery_not_configured",
      503,
      "Die ausgehende Zapier-Zustellung ist noch nicht konfiguriert."
    );
  }

  const maxItems = Math.min(
    25,
    Math.max(1, options.maxItems ?? DEFAULT_BATCH_SIZE)
  );
  const clock = options.now ?? (() => new Date());
  summary.permanentFailures +=
    await failExhaustedUnclaimedZapierOutboxes(
      env,
      clock(),
      MAX_ATTEMPTS
    );

  for (let index = 0; index < maxItems; index += 1) {
    const claimTime = clock();
    const leaseOwner = `zapier-outbox:${crypto.randomUUID()}`;
    const lease = await claimNextZapierOutbox(
      env,
      leaseOwner,
      claimTime,
      LEASE_DURATION_SECONDS,
      MAX_ATTEMPTS
    );
    if (!lease) {
      break;
    }

    let deliveryResult: SinkResult;
    try {
      const event = parseProspectContactEventJson(lease.payloadJson);
      if (event.eventId !== lease.eventId) {
        throw new AppError(
          "event_identity_mismatch",
          500,
          "Ein gespeichertes Ereignis besitzt eine widersprüchliche ID."
        );
      }
      deliveryResult = await deliverToZapier(
        {
          deliveryId: lease.deliveryId,
          deliveryToken: lease.deliveryToken,
          eventId: event.eventId,
          eventType: event.eventType,
          schemaVersion: 1
        },
        {
          enabled: true,
          signingSecret: env.ZAPIER_WEBHOOK_SIGNING_SECRET,
          targetUrl: lease.targetUrl
        },
        options.fetchImplementation
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code !== "invalid_event_payload" &&
        error.code !== "event_identity_mismatch" &&
        error.code !== "invalid_zapier_target"
      ) {
        throw error;
      }
      deliveryResult = {
        outcome: "permanent_error",
        httpStatus: null,
        errorCode:
          error instanceof AppError ? error.code : "invalid_event_payload"
      };
    }

    const finalizedAt = clock();
    const finalState = await finalizeZapierOutboxAttempt(
      env,
      lease,
      deliveryResult,
      finalizedAt,
      MAX_ATTEMPTS
    );
    summary.processed += 1;
    if (finalState === "accepted") {
      summary.accepted += 1;
    } else if (finalState === "claim_wait") {
      summary.awaitingClaims += 1;
    } else if (finalState === "retry_wait") {
      summary.retriesScheduled += 1;
    } else {
      summary.permanentFailures += 1;
    }
  }

  return summary;
}
