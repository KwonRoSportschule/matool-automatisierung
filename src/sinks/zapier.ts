import { AppError } from "../core/app-error";
import { canonicalJson, hmacSha256Base64Url } from "../core/crypto";

export interface ZapierDeliveryEnvelope {
  deliveryId: string;
  deliveryToken: string;
  eventId: string;
  eventType: string;
  schemaVersion: 1;
}

export interface ZapierSinkConfig {
  enabled: boolean;
  signingSecret: string;
  targetUrl: string;
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
  envelope: ZapierDeliveryEnvelope,
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

  const url = validateZapierTargetUrl(config.targetUrl);
  const body = canonicalJson({
    delivery_id: envelope.deliveryId,
    delivery_token: envelope.deliveryToken,
    event_id: envelope.eventId,
    event_type: envelope.eventType,
    schema_version: envelope.schemaVersion
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSha256Base64Url(
    config.signingSecret,
    `${timestamp}.${body}`
  );

  try {
    const response = await fetchImplementation(url, {
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Matool-Event-Id": envelope.eventId,
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

    if (response.status === 410) {
      return {
        outcome: "permanent_error",
        httpStatus: response.status,
        errorCode: "zapier_subscription_gone"
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

export function validateZapierTargetUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidHook();
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.zapier.com" ||
    url.pathname === "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw invalidHook();
  }

  return url;
}

export const validateZapierHookUrl = validateZapierTargetUrl;

function invalidHook(): AppError {
  return new AppError(
    "invalid_zapier_target",
    500,
    "Die Zapier-Zieladresse ist ungültig."
  );
}
