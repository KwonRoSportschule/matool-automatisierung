import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload
} from "jose";

import { AppError } from "../core/app-error";
import type { Env } from "./env";

export interface AccessIdentity {
  subject: string;
  email?: string;
  authentication:
    | "cloudflare-access"
    | "local-development"
    | "public-read-only";
}

export type AccessScope = "employee" | "zapier-service";

const jwksByIssuer = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

export async function requireAccessIdentity(
  request: Request,
  env: Env,
  scope: AccessScope = "employee"
): Promise<AccessIdentity> {
  const publicIdentity = getPublicReadOnlyIdentity(request, env, scope);
  if (publicIdentity) {
    return publicIdentity;
  }

  const localIdentity = getLocalDevelopmentIdentity(request, env);
  if (localIdentity) {
    return localIdentity;
  }

  const issuer = normalizeAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience =
    scope === "zapier-service"
      ? env.ACCESS_SERVICE_AUD
      : env.ACCESS_AUD;
  if (
    !audience ||
    audience.length === 0 ||
    audience.startsWith("configure-with-") ||
    (
      env.ACCESS_SERVICE_AUD !== undefined &&
      env.ACCESS_SERVICE_AUD === env.ACCESS_AUD
    )
  ) {
    throw new AppError(
      "access_not_configured",
      503,
      "Cloudflare Access ist noch nicht vollständig konfiguriert."
    );
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (!token) {
    throw new AppError(
      "access_denied",
      403,
      "Der Mitarbeiterzugriff konnte nicht bestätigt werden."
    );
  }

  try {
    const jwks =
      jwksByIssuer.get(issuer) ??
      createAndCacheRemoteJwks(issuer);
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      audience,
      issuer,
      clockTolerance: 5
    });

    return accessIdentityFromPayload(payload, scope);
  } catch {
    throw new AppError(
      "access_denied",
      403,
      "Der Mitarbeiterzugriff konnte nicht bestätigt werden."
    );
  }
}

export function accessIdentityFromPayload(
  payload: JWTPayload,
  scope: AccessScope
): AccessIdentity {
  if (payload.type !== "app") {
    throw new Error("unexpected access token type");
  }

  if (scope === "zapier-service") {
    const commonName =
      typeof payload.common_name === "string"
        ? payload.common_name.trim()
        : "";
    if (payload.sub !== "" || commonName.length === 0) {
      throw new Error("missing service token identity");
    }

    return {
      subject: `service-token:${commonName}`,
      authentication: "cloudflare-access"
    };
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("missing employee subject");
  }
  const email =
    typeof payload.email === "string" ? payload.email : undefined;

  return {
    subject: payload.sub,
    ...(email ? { email } : {}),
    authentication: "cloudflare-access"
  };
}

export function normalizeAccessTeamDomain(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppError(
      "access_not_configured",
      503,
      "Die Cloudflare-Access-Domain ist ungültig."
    );
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.hostname === "cloudflareaccess.com" ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      "access_not_configured",
      503,
      "Die Cloudflare-Access-Domain ist ungültig."
    );
  }

  return url.origin;
}

function getPublicReadOnlyIdentity(
  request: Request,
  env: Env,
  scope: AccessScope
): AccessIdentity | null {
  if (
    scope !== "employee" ||
    env.APP_ENV !== "staging" ||
    env.PUBLIC_DASHBOARD_READ_ONLY !== "true" ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return null;
  }

  const pathname = new URL(request.url).pathname;
  const isReadOnlyApi =
    request.method === "GET" &&
    (
      pathname === "/api/admin/v1/status" ||
      pathname === "/api/admin/v1/runs"
    );
  const isStaticAsset = !pathname.startsWith("/api/");
  if (!isReadOnlyApi && !isStaticAsset) {
    return null;
  }

  return {
    subject: "public-dashboard-read-only",
    authentication: "public-read-only"
  };
}

function createAndCacheRemoteJwks(
  issuer: string
): ReturnType<typeof createRemoteJWKSet> {
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`)
  );
  jwksByIssuer.set(issuer, jwks);
  return jwks;
}

function getLocalDevelopmentIdentity(
  request: Request,
  env: Env
): AccessIdentity | null {
  if (
    env.APP_ENV === "production" ||
    env.APP_ENV === "staging" ||
    env.DEV_AUTH_BYPASS !== "allow-loopback-only"
  ) {
    return null;
  }

  const hostname = new URL(request.url).hostname;
  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";

  if (!isLoopback) {
    return null;
  }

  return {
    subject: "local-development",
    authentication: "local-development"
  };
}
