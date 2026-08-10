export const API_PATHS = {
  account: "/api/zapier/v1/account",
  snapshots: "/api/zapier/v1/snapshots"
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
