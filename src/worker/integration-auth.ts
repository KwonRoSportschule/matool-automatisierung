import { AppError } from "../core/app-error";
import { timingSafeEqual } from "../core/crypto";
import type { Env } from "./env";

export function requireZapierServiceRequest(
  request: Request,
  env: Env
): void {
  const configuredToken = env.ZAPIER_SERVICE_TOKEN;
  if (!configuredToken || configuredToken.length < 32) {
    throw new AppError(
      "zapier_service_auth_not_configured",
      503,
      "Die Zapier-Serviceauthentifizierung ist noch nicht konfiguriert."
    );
  }

  const authorization = request.headers.get("Authorization")?.trim();
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (
    suppliedToken.length === 0 ||
    !timingSafeEqual(suppliedToken, configuredToken)
  ) {
    throw new AppError(
      "integration_access_denied",
      403,
      "Die Integrationsanfrage konnte nicht bestätigt werden."
    );
  }
}
