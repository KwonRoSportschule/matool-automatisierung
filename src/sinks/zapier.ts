import { AppError } from "../core/app-error";
import { canonicalJson, hmacSha256Base64Url } from "../core/crypto";
import type { ProspectContactEvent } from "../core/first-trial";

export interface ZapierSinkConfig {
  catchHookUrl: string;
  enabled: boolean;
  signingSecret: string;
}

export type SinkResult =
  | {
      outcome: "accepted";
      httpStatus: number;
    }
  | {
      outcome: "retryable_error" | "permanent_error";
      httpStatus: number | null;
      errorCode: string;
    };

export async function deliverToZapier(
  event: ProspectContactEvent,
  config: ZapierSinkConfig,
  fetchImplementation: typeof fetch = fetch
): Promise<SinkResult> {
  if (!config.enabled) {
    throw new AppError(
      "zapier_delivery_disabled",
      409,
      "Ausgehende Zapier-Zustellungen sind deaktiviert."
    );
  }

  if (config.signingSecret.length < 24) {
    throw new AppError(
      "zapier_signing_not_configured",
      500,
      "Die Signatur für Zapier ist nicht konfiguriert."
    );
  }

  const url = validateZapierHookUrl(config.catchHookUrl);
  const body = canonicalJson({
    event_id: event.eventId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    payload_version: event.payloadVersion,
    prospect: {
      email: event.prospect.email,
      first_name: event.prospect.firstName,
      phone: event.prospect.phone
    },
    first_trial: {
      appointment_id: event.firstTrial.appointmentId,
      location_code: event.firstTrial.locationCode,
      starts_at: event.firstTrial.startsAt
    },
    contact: {
      channel: event.contact.channel,
      due_at: event.contact.dueAt
    }
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSha256Base64Url(
    config.signingSecret,
    `${timestamp}.${event.eventId}.${body}`
  );

  try {
    const response = await fetchImplementation(url, {
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Matool-Event-Id": event.eventId,
        "X-Matool-Signature": `v1=${signature}`,
        "X-Matool-Timestamp": timestamp
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000)
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        outcome: "accepted",
        httpStatus: response.status
      };
    }

    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return {
        outcome: "retryable_error",
        httpStatus: response.status,
        errorCode: "zapier_retryable_status"
      };
    }

    return {
      outcome: "permanent_error",
      httpStatus: response.status,
      errorCode: "zapier_rejected"
    };
  } catch {
    return {
      outcome: "retryable_error",
      httpStatus: null,
      errorCode: "zapier_network_error"
    };
  }
}

export function validateZapierHookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidHook();
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.zapier.com" ||
    !url.pathname.startsWith("/hooks/catch/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw invalidHook();
  }

  return url;
}

function invalidHook(): AppError {
  return new AppError(
    "invalid_zapier_hook",
    500,
    "Die Zapier-Catch-Hook-Adresse ist ungültig."
  );
}
