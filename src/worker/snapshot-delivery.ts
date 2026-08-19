import { AppError } from "../core/app-error";
import { jsonResponse, methodNotAllowed } from "../core/http";
import { validateZapierTargetUrl } from "../sinks/zapier";
import type { Env } from "./env";
import {
  claimNextSnapshotZapierDelivery,
  completeSnapshotZapierDelivery,
  createSnapshotZapierSubscription,
  disableGoneSnapshotZapierSubscription,
  disableSnapshotZapierSubscription,
  retrySnapshotZapierDelivery,
  type SnapshotZapierDeliveryLease
} from "./snapshot-delivery-store";

const MAX_SUBSCRIPTION_BODY_BYTES = 8_192;
const MAX_TARGET_URL_LENGTH = 2_048;
const MAX_DELIVERIES_PER_RUN = 50;
const MAX_CONCURRENT_DELIVERIES = 4;
const DELIVERY_PROCESSING_BUDGET_MS = 20_000;
const DELIVERY_REQUEST_TIMEOUT_MS = 3_000;
const DELIVERY_LEASE_SECONDS = 30;

export interface SnapshotDeliverySummary {
  completed: number;
  disabled: number;
  processed: number;
  retried: number;
}

interface DeliveryResult {
  errorCode?: string;
  outcome: "complete" | "disable" | "retry";
}

export async function handleSnapshotSubscriptionApiRequest(
  request: Request,
  url: URL,
  env: Env,
  allowedAreas: readonly string[]
): Promise<Response> {
  if (url.pathname === "/api/zapier/v1/snapshot-subscriptions") {
    if (request.method !== "POST") {
      methodNotAllowed(["POST"]);
    }

    const body = await readSubscriptionBody(request);
    if (
      typeof body.area !== "string" ||
      !allowedAreas.includes(body.area) ||
      typeof body.only_changed !== "boolean" ||
      typeof body.target_url !== "string" ||
      body.target_url.length === 0 ||
      body.target_url.length > MAX_TARGET_URL_LENGTH
    ) {
      invalidSubscriptionPayload();
    }

    let targetUrl: URL;
    try {
      targetUrl = validateZapierTargetUrl(body.target_url);
    } catch {
      invalidSubscriptionPayload();
    }
    if (targetUrl.port !== "") {
      invalidSubscriptionPayload();
    }

    const subscription = await createSnapshotZapierSubscription(
      env.DB,
      {
        area: body.area,
        onlyChanged: body.only_changed,
        targetUrl: targetUrl.toString()
      },
      new Date()
    );
    return jsonResponse(
      {
        schema_version: 1,
        id: subscription.id,
        area: body.area,
        only_changed: body.only_changed
      },
      { status: 201 }
    );
  }

  const subscriptionMatch =
    /^\/api\/zapier\/v1\/snapshot-subscriptions\/(zsnap_[a-f0-9-]{36})$/u.exec(
      url.pathname
    );
  if (subscriptionMatch?.[1]) {
    if (request.method !== "DELETE") {
      methodNotAllowed(["DELETE"]);
    }
    const disabled = await disableSnapshotZapierSubscription(
      env.DB,
      subscriptionMatch[1],
      new Date()
    );
    return jsonResponse({
      schema_version: 1,
      id: subscriptionMatch[1],
      disabled
    });
  }

  throw new AppError(
    "route_not_found",
    404,
    "Die angeforderte API-Route existiert nicht."
  );
}

export async function processSnapshotZapierDeliveries(
  env: Env,
  fetchImplementation: typeof fetch = fetch
): Promise<SnapshotDeliverySummary> {
  const summary: SnapshotDeliverySummary = {
    completed: 0,
    disabled: 0,
    processed: 0,
    retried: 0
  };
  if (env.OUTBOUND_DELIVERY_ENABLED !== "true") {
    return summary;
  }

  const leaseOwner = `snapshot_delivery_${crypto.randomUUID()}`;
  const deadline = Date.now() + DELIVERY_PROCESSING_BUDGET_MS;

  while (
    summary.processed < MAX_DELIVERIES_PER_RUN &&
    Date.now() < deadline
  ) {
    const leases: SnapshotZapierDeliveryLease[] = [];
    const availableSlots = Math.min(
      MAX_CONCURRENT_DELIVERIES,
      MAX_DELIVERIES_PER_RUN - summary.processed
    );
    for (let index = 0; index < availableSlots; index += 1) {
      const lease = await claimNextSnapshotZapierDelivery(
        env.DB,
        leaseOwner,
        new Date(),
        DELIVERY_LEASE_SECONDS
      );
      if (!lease) {
        break;
      }
      leases.push(lease);
    }
    if (leases.length === 0) {
      break;
    }

    const results = await Promise.all(
      leases.map(async (lease) => ({
        lease,
        result: await deliverSnapshotEvent(lease, fetchImplementation)
      }))
    );
    for (const { lease, result } of results) {
      const now = new Date();
      if (result.outcome === "complete") {
        await completeSnapshotZapierDelivery(env.DB, lease, now);
        summary.completed += 1;
      } else if (result.outcome === "disable") {
        await disableGoneSnapshotZapierSubscription(env.DB, lease, now);
        summary.disabled += 1;
      } else {
        await retrySnapshotZapierDelivery(
          env.DB,
          lease,
          result.errorCode ?? "snapshot_zapier_delivery_failed",
          now
        );
        summary.retried += 1;
      }
      summary.processed += 1;
    }
  }

  return summary;
}

async function deliverSnapshotEvent(
  lease: SnapshotZapierDeliveryLease,
  fetchImplementation: typeof fetch
): Promise<DeliveryResult> {
  let targetUrl: URL;
  try {
    targetUrl = validateZapierTargetUrl(lease.targetUrl);
    if (targetUrl.port !== "") {
      return {
        errorCode: "snapshot_zapier_target_invalid",
        outcome: "retry"
      };
    }
  } catch {
    return {
      errorCode: "snapshot_zapier_target_invalid",
      outcome: "retry"
    };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(lease.payloadJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("invalid snapshot payload");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return {
      errorCode: "snapshot_zapier_payload_invalid",
      outcome: "retry"
    };
  }

  const body = JSON.stringify({
    ...payload,
    id: lease.eventId,
    area: lease.area,
    change_id: lease.changeId,
    change_kind: lease.changeKind,
    source_id: lease.sourceId,
    matool_id: /^\d+$/u.test(lease.sourceId) ? lease.sourceId : null,
    content_hash: lease.contentHash,
    first_seen_at: lease.firstSeenAt,
    last_changed_at: lease.observedAt,
    last_seen_at: lease.lastSeenAt,
    observed_at: lease.observedAt,
    zapier_event_id: lease.eventId,
    is_new: lease.changeKind === "created"
  });

  try {
    const response = await fetchImplementation(targetUrl, {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_REQUEST_TIMEOUT_MS)
    });
    try {
      await response.body?.cancel();
    } catch {
      // Der Status ist bereits verfuegbar; ein fehlerhaftes Body-Cancel darf
      // die persistierte Zustellentscheidung nicht veraendern.
    }

    if (response.status >= 200 && response.status < 300) {
      return { outcome: "complete" };
    }
    if (response.status === 410) {
      return { outcome: "disable" };
    }
    if (response.status === 429) {
      return {
        errorCode: "snapshot_zapier_rate_limited",
        outcome: "retry"
      };
    }
    if (response.status >= 500) {
      return {
        errorCode: "snapshot_zapier_server_error",
        outcome: "retry"
      };
    }
    return {
      errorCode: "snapshot_zapier_rejected",
      outcome: "retry"
    };
  } catch {
    return {
      errorCode: "snapshot_zapier_network_error",
      outcome: "retry"
    };
  }
}

async function readSubscriptionBody(
  request: Request
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    invalidSubscriptionPayload();
  }

  const declaredLength = Number.parseInt(
    request.headers.get("Content-Length") ?? "0",
    10
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SUBSCRIPTION_BODY_BYTES
  ) {
    invalidSubscriptionPayload();
  }

  const text = await request.text();
  if (
    new TextEncoder().encode(text).byteLength >
    MAX_SUBSCRIPTION_BODY_BYTES
  ) {
    invalidSubscriptionPayload();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalidSubscriptionPayload();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidSubscriptionPayload();
  }
  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== "area,only_changed,target_url") {
    invalidSubscriptionPayload();
  }
  return body;
}

function invalidSubscriptionPayload(): never {
  throw new AppError(
    "invalid_snapshot_subscription",
    400,
    "Die Snapshot-Subscription ist ungueltig."
  );
}
