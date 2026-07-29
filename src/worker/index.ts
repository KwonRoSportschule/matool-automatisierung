import { AppError } from "../core/app-error";
import {
  apiErrorResponse,
  hardenAssetResponse,
  jsonResponse,
  methodNotAllowed
} from "../core/http";
import { MatoolClient } from "../matool/client";
import { requireAccessIdentity } from "./access";
import { issueCsrfToken, requireValidCsrfRequest } from "./csrf";
import type { Env } from "./env";
import { getAdminStatus, listRuns } from "./repository";
import { handleScheduledInvocation } from "./schedule";

const worker = {
  async fetch(
    request: Request,
    env: Env,
    _context: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/healthz") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          methodNotAllowed(["GET", "HEAD"]);
        }

        const response = jsonResponse({
          schemaVersion: 1,
          service: "matool-middleware-hub",
          status: "ok"
        });
        return request.method === "HEAD"
          ? new Response(null, response)
          : response;
      }

      const identity = await requireAccessIdentity(request, env);

      if (url.pathname.startsWith("/api/")) {
        return await handleApiRequest(request, url, identity, env);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        methodNotAllowed(["GET", "HEAD"]);
      }

      return hardenAssetResponse(await env.ASSETS.fetch(request));
    } catch (error) {
      return apiErrorResponse(error);
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext
  ): Promise<void> {
    context.waitUntil(handleScheduledInvocation(controller, env));
  }
} satisfies ExportedHandler<Env>;

async function handleApiRequest(
  request: Request,
  url: URL,
  identity: Awaited<ReturnType<typeof requireAccessIdentity>>,
  env: Env
): Promise<Response> {
  if (url.pathname === "/api/admin/v1/status") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse(await getAdminStatus(env));
  }

  if (url.pathname === "/api/admin/v1/runs") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }

    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(50, Math.max(1, rawLimit))
      : 20;
    return jsonResponse(await listRuns(env, limit));
  }

  if (url.pathname === "/api/admin/v1/csrf") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse({
      schemaVersion: 1,
      ...(await issueCsrfToken(identity, env))
    });
  }

  if (url.pathname === "/api/admin/v1/sync/dry-run") {
    await requireValidCsrfRequest(request, identity, env);

    if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
      throw new AppError(
        "matool_not_configured",
        409,
        "Die MATOOL-Verbindung ist noch nicht eingerichtet."
      );
    }

    if (env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
      throw new AppError(
        "matool_runs_not_confirmed",
        409,
        "Read-only-Echtdatenläufe sind noch nicht freigegeben."
      );
    }

    throw new AppError(
      "collector_mapping_open",
      409,
      "Die Feldzuordnung für den ersten Probetrainingstermin muss zuerst verifiziert werden."
    );
  }

  if (url.pathname === "/api/admin/v1/matool/probe") {
    await requireValidCsrfRequest(request, identity, env);

    if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
      throw new AppError(
        "matool_not_configured",
        409,
        "Die MATOOL-Verbindung ist noch nicht eingerichtet."
      );
    }

    if (env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
      throw new AppError(
        "matool_runs_not_confirmed",
        409,
        "Passwortrotation und read-only-Strukturprobe müssen zuerst bestätigt werden."
      );
    }

    const client = new MatoolClient(env.MATOOL_BASE_URL);
    try {
      const result = await client.probeInteressenten({
        email: env.MATOOL_EMAIL,
        password: env.MATOOL_PASSWORD
      });
      return jsonResponse({
        schemaVersion: 1,
        probe: {
          bodyBytes: result.bodyBytes,
          contentType: result.contentType,
          cookieCount: result.cookieNames.length,
          interestMarkerDetected: result.interestMarkerDetected,
          loginFormDetected: result.loginFormDetected,
          rowMarkerCount: result.rowMarkerCount,
          status: result.status
        }
      });
    } finally {
      client.clearSession();
    }
  }

  throw new AppError(
    "route_not_found",
    404,
    "Die angeforderte API-Route existiert nicht."
  );
}

export default worker;
