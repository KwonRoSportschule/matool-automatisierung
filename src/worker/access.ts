import { createRemoteJWKSet, jwtVerify } from "jose";

import { AppError } from "../core/app-error";
import type { Env } from "./env";

export interface AccessIdentity {
  subject: string;
  email?: string;
  authentication: "cloudflare-access" | "local-development";
}

const jwksByIssuer = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

export async function requireAccessIdentity(
  request: Request,
  env: Env
): Promise<AccessIdentity> {
  const localIdentity = getLocalDevelopmentIdentity(request, env);
  if (localIdentity) {
    return localIdentity;
  }

  const issuer = normalizeAccessTeamDomain(env.ACCESS_TEAM_DOMAIN);
  if (
    env.ACCESS_AUD.length === 0 ||
    env.ACCESS_AUD.startsWith("configure-with-")
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
      audience: env.ACCESS_AUD,
      issuer,
      clockTolerance: 5
    });

    if (!payload.sub) {
      throw new Error("missing subject");
    }

    const email =
      typeof payload.email === "string" ? payload.email : undefined;

    return {
      subject: payload.sub,
      ...(email ? { email } : {}),
      authentication: "cloudflare-access"
    };
  } catch {
    throw new AppError(
      "access_denied",
      403,
      "Der Mitarbeiterzugriff konnte nicht bestätigt werden."
    );
  }
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
