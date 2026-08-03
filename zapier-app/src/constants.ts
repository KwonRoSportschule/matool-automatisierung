export const FIRST_TRIAL_EVENT_TYPE =
  "prospect.first_trial_contact_due" as const;
export const SYNTHETIC_EVENT_ID = "0".repeat(64);
export const SYNTHETIC_CLAIM_ID =
  "zclaim_00000000-0000-4000-8000-000000000000";

export const API_PATHS = {
  account: "/api/zapier/v1/account",
  claim: "/api/zapier/v1/events/claim",
  confirm: "/api/zapier/v1/events/confirm",
  sample: "/api/zapier/v1/events/sample",
  snapshots: "/api/zapier/v1/snapshots",
  subscriptions: "/api/zapier/v1/subscriptions"
} as const;

export function configuredMiddlewareOrigin(): string {
  return normalizeMiddlewareUrl(
    process.env.MATOOL_MIDDLEWARE_ORIGIN ?? ""
  );
}

export function normalizeMiddlewareUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Die Middleware-Adresse ist ungültig.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Die Middleware-Adresse muss eine HTTPS-Adresse ohne Pfad sein."
    );
  }

  return url.origin;
}

export function middlewareApiUrl(
  path: string
): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Der Middleware-API-Pfad ist ungültig.");
  }
  return `${configuredMiddlewareOrigin()}${path}`;
}
