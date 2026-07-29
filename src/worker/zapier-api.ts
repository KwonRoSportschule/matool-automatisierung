import { AppError } from "../core/app-error";
import {
  FIRST_TRIAL_EVENT_TYPE,
  parseProspectContactEventJson,
  type ProspectContactEvent
} from "../core/first-trial";
import { jsonResponse, methodNotAllowed } from "../core/http";
import { validateZapierTargetUrl } from "../sinks/zapier";
import {
  claimEventForZapier,
  confirmEventForZapier,
  createZapierSubscription,
  disableZapierSubscription
} from "./delivery-repository";
import type { Env } from "./env";
import { requireZapierServiceRequest } from "./integration-auth";

const MAX_JSON_BODY_BYTES = 8_192;
const SYNTHETIC_EVENT_ID = "0".repeat(64);
const SYNTHETIC_CLAIM_ID =
  "zclaim_00000000-0000-4000-8000-000000000000";

export async function handleZapierApiRequest(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  requireZapierServiceRequest(request, env);

  if (url.pathname === "/api/zapier/v1/account") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse({
      schema_version: 1,
      id: "kwonro-matool-middleware",
      environment: env.APP_ENV,
      event_types: [FIRST_TRIAL_EVENT_TYPE],
      subscription_limit_per_event_type: 1,
      token_scopes: [
        "subscriptions:write",
        "events:claim",
        "events:confirm",
        "events:sample"
      ]
    });
  }

  if (url.pathname === "/api/zapier/v1/subscriptions") {
    if (request.method !== "POST") {
      methodNotAllowed(["POST"]);
    }
    const body = await readJsonObject(request);
    if (
      body.event_type !== FIRST_TRIAL_EVENT_TYPE ||
      typeof body.target_url !== "string"
    ) {
      invalidPayload();
    }

    let targetUrl: string;
    try {
      targetUrl = validateZapierTargetUrl(body.target_url).toString();
    } catch {
      invalidPayload();
    }
    const subscription = await createZapierSubscription(
      env,
      FIRST_TRIAL_EVENT_TYPE,
      targetUrl,
      new Date()
    );
    return jsonResponse(
      {
        schema_version: 1,
        id: subscription.id,
        event_type: FIRST_TRIAL_EVENT_TYPE
      },
      { status: 201 }
    );
  }

  const subscriptionMatch = url.pathname.match(
    /^\/api\/zapier\/v1\/subscriptions\/(zsub_[a-f0-9-]{36})$/u
  );
  if (subscriptionMatch) {
    if (request.method !== "DELETE") {
      methodNotAllowed(["DELETE"]);
    }
    const subscriptionId = subscriptionMatch[1];
    if (!subscriptionId) {
      invalidPayload();
    }
    await disableZapierSubscription(env, subscriptionId, new Date());
    return jsonResponse({
      schema_version: 1,
      id: subscriptionId,
      disabled: true
    });
  }

  if (url.pathname === "/api/zapier/v1/events/claim") {
    if (request.method !== "POST") {
      methodNotAllowed(["POST"]);
    }
    const body = await readJsonObject(request);
    const input = parseClaimInput(body);
    const result = await claimEventForZapier(env, input, new Date());
    if (!result.claimed) {
      return jsonResponse({
        schema_version: 1,
        claimed: false,
        state: result.state
      });
    }

    const event = parseProspectContactEventJson(result.eventPayloadJson);
    if (event.eventId !== input.eventId) {
      throw new AppError(
        "claimed_event_identity_mismatch",
        500,
        "Das beanspruchte Ereignis besitzt eine widersprüchliche ID."
      );
    }
    return jsonResponse({
      schema_version: 1,
      claimed: true,
      state: result.state,
      event: mapEventForZapier(event, result.claimId)
    });
  }

  if (url.pathname === "/api/zapier/v1/events/confirm") {
    if (request.method !== "POST") {
      methodNotAllowed(["POST"]);
    }
    const body = await readJsonObject(request);
    const input = parseConfirmationInput(body);
    const result = await confirmEventForZapier(env, input, new Date());
    return jsonResponse({
      schema_version: 1,
      ...result
    });
  }

  if (url.pathname === "/api/zapier/v1/events/sample") {
    if (request.method !== "POST") {
      methodNotAllowed(["POST"]);
    }
    const body = await readJsonObject(request);
    if (body.event_type !== FIRST_TRIAL_EVENT_TYPE) {
      invalidPayload();
    }
    return jsonResponse({
      schema_version: 1,
      events: [syntheticZapierSample()]
    });
  }

  throw new AppError(
    "route_not_found",
    404,
    "Die angeforderte API-Route existiert nicht."
  );
}

function parseClaimInput(body: Record<string, unknown>): {
  deliveryId: string;
  deliveryToken: string;
  eventId: string;
} {
  if (
    typeof body.event_id !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body.event_id) ||
    typeof body.delivery_id !== "string" ||
    body.delivery_id.length < 10 ||
    body.delivery_id.length > 240 ||
    typeof body.delivery_token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(body.delivery_token)
  ) {
    invalidPayload();
  }

  return {
    deliveryId: body.delivery_id,
    deliveryToken: body.delivery_token,
    eventId: body.event_id
  };
}

function parseConfirmationInput(body: Record<string, unknown>): {
  claimId: string;
  eventId: string;
  failureCode: string | null;
  outcome: "succeeded" | "failed";
} {
  const failureCode =
    body.failure_code === null || body.failure_code === undefined
      ? null
      : body.failure_code;
  if (
    typeof body.event_id !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body.event_id) ||
    typeof body.claim_id !== "string" ||
    !/^zclaim_[a-f0-9-]{36}$/u.test(body.claim_id) ||
    (body.outcome !== "succeeded" && body.outcome !== "failed") ||
    (failureCode !== null &&
      (typeof failureCode !== "string" ||
        !/^[a-z0-9_.-]{1,64}$/u.test(failureCode))) ||
    (body.outcome === "succeeded" && failureCode !== null)
  ) {
    invalidPayload();
  }

  return {
    claimId: body.claim_id,
    eventId: body.event_id,
    failureCode,
    outcome: body.outcome
  };
}

async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    invalidPayload();
  }

  const declaredLength = Number.parseInt(
    request.headers.get("Content-Length") ?? "0",
    10
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JSON_BODY_BYTES
  ) {
    invalidPayload();
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) {
    invalidPayload();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    invalidPayload();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidPayload();
  }
  return parsed as Record<string, unknown>;
}

function mapEventForZapier(
  event: ProspectContactEvent,
  claimId: string
): Record<string, unknown> {
  const exposeEmail =
    event.contact.channel === "email" ||
    event.contact.channel === "staff_task";
  const exposePhone =
    event.contact.channel === "sms" ||
    event.contact.channel === "staff_task";

  return {
    id: event.eventId,
    event_id: event.eventId,
    event_type: event.eventType,
    claim_id: claimId,
    occurred_at: event.occurredAt,
    payload_version: event.payloadVersion,
    prospect: {
      first_name: event.prospect.firstName,
      email: exposeEmail ? event.prospect.email : null,
      phone: exposePhone ? event.prospect.phone : null
    },
    first_trial: {
      appointment_id: event.firstTrial.appointmentId,
      starts_at: event.firstTrial.startsAt,
      location_code: event.firstTrial.locationCode
    },
    contact: {
      channel: event.contact.channel,
      due_at: event.contact.dueAt
    }
  };
}

function syntheticZapierSample(): Record<string, unknown> {
  return {
    id: SYNTHETIC_EVENT_ID,
    event_id: SYNTHETIC_EVENT_ID,
    event_type: FIRST_TRIAL_EVENT_TYPE,
    claim_id: SYNTHETIC_CLAIM_ID,
    occurred_at: "2026-08-03T16:30:00.000Z",
    payload_version: 1,
    prospect: {
      first_name: "Beispiel",
      email: "beispiel@example.invalid",
      phone: null
    },
    first_trial: {
      appointment_id: "synthetic-appointment-id",
      starts_at: "2026-08-04T16:00:00.000Z",
      location_code: "synthetic-location"
    },
    contact: {
      channel: "email",
      due_at: "2026-08-03T16:00:00.000Z"
    }
  };
}

function invalidPayload(): never {
  throw new AppError(
    "invalid_integration_payload",
    400,
    "Die Integrationsanfrage ist ungültig."
  );
}
