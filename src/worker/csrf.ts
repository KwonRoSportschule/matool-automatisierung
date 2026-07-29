import { AppError } from "../core/app-error";
import {
  base64UrlDecodeText,
  base64UrlEncodeText,
  hmacSha256Base64Url,
  timingSafeEqual
} from "../core/crypto";
import type { AccessIdentity } from "./access";
import type { Env } from "./env";

interface CsrfClaims {
  expiresAt: number;
  nonce: string;
  subject: string;
}

const CSRF_TTL_SECONDS = 15 * 60;

export async function issueCsrfToken(
  identity: AccessIdentity,
  env: Env,
  now = new Date()
): Promise<{ expiresAt: string; token: string }> {
  const secret = requireCsrfSecret(env);
  const claims: CsrfClaims = {
    expiresAt: Math.floor(now.getTime() / 1000) + CSRF_TTL_SECONDS,
    nonce: crypto.randomUUID(),
    subject: identity.subject
  };
  const encodedClaims = base64UrlEncodeText(JSON.stringify(claims));
  const signature = await hmacSha256Base64Url(
    secret,
    `v1.${encodedClaims}`
  );

  return {
    expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
    token: `v1.${encodedClaims}.${signature}`
  };
}

export async function requireValidCsrfRequest(
  request: Request,
  identity: AccessIdentity,
  env: Env,
  now = new Date()
): Promise<void> {
  if (request.method !== "POST") {
    throw new AppError(
      "method_not_allowed",
      405,
      "Diese Aktion erwartet eine POST-Anfrage."
    );
  }

  const expectedOrigin =
    env.ADMIN_ORIGIN?.trim() || new URL(request.url).origin;
  if (request.headers.get("Origin") !== expectedOrigin) {
    throw new AppError(
      "csrf_denied",
      403,
      "Die Herkunft der Anfrage konnte nicht bestätigt werden."
    );
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new AppError(
      "csrf_denied",
      403,
      "Die Herkunft der Anfrage konnte nicht bestätigt werden."
    );
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError(
      "unsupported_media_type",
      415,
      "Diese Aktion erwartet JSON."
    );
  }

  const token = request.headers.get("X-CSRF-Token");
  if (!token) {
    throw new AppError(
      "csrf_denied",
      403,
      "Die Sicherheitsbestätigung fehlt."
    );
  }

  await verifyCsrfToken(token, identity, env, now);
}

async function verifyCsrfToken(
  token: string,
  identity: AccessIdentity,
  env: Env,
  now: Date
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw csrfError();
  }

  const encodedClaims = parts[1];
  const providedSignature = parts[2];
  if (!encodedClaims || !providedSignature) {
    throw csrfError();
  }

  const expectedSignature = await hmacSha256Base64Url(
    requireCsrfSecret(env),
    `v1.${encodedClaims}`
  );
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    throw csrfError();
  }

  let claims: CsrfClaims;
  try {
    claims = JSON.parse(base64UrlDecodeText(encodedClaims)) as CsrfClaims;
  } catch {
    throw csrfError();
  }

  if (
    claims.subject !== identity.subject ||
    typeof claims.expiresAt !== "number" ||
    claims.expiresAt < Math.floor(now.getTime() / 1000) ||
    typeof claims.nonce !== "string" ||
    claims.nonce.length < 16
  ) {
    throw csrfError();
  }
}

function requireCsrfSecret(env: Env): string {
  if (!env.CSRF_SECRET || env.CSRF_SECRET.length < 24) {
    throw new AppError(
      "csrf_not_configured",
      503,
      "Der Schutz für Mitarbeiteraktionen ist noch nicht konfiguriert."
    );
  }

  return env.CSRF_SECRET;
}

function csrfError(): AppError {
  return new AppError(
    "csrf_denied",
    403,
    "Die Sicherheitsbestätigung ist ungültig oder abgelaufen."
  );
}
