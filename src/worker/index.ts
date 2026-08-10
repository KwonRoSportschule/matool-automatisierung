import { AppError } from "../core/app-error";
import {
  apiErrorResponse,
  hardenAssetResponse,
  jsonResponse,
  methodNotAllowed
} from "../core/http";
import { MatoolClient } from "../matool/client";
import {
  dashboardAccessSummary,
  requireAccessIdentity
} from "./access";
import { issueCsrfToken, requireValidCsrfRequest } from "./csrf";
import { requireDashboardPublicId } from "./dashboard-privacy";
import {
  parseDashboardActivityQuery,
  parseDashboardOverviewQuery,
  parseDashboardRecordDetailQuery,
  parseDashboardRecordQuery
} from "./dashboard-query";
import {
  getDashboardOverview,
  getDashboardRecord,
  listDashboardActivities,
  listDashboardRecords
} from "./dashboard-repository";
import type { Env } from "./env";
import {
  getAdminStatus,
  listAreaSnapshots,
  listRuns
} from "./repository";
import {
  MATOOL_SNAPSHOT_AREAS,
  collectMatoolSnapshots,
  handleScheduledInvocation
} from "./schedule";
import { handleZapierApiRequest } from "./zapier-api";

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

      // Zapier is authenticated by the dedicated middleware bearer token in
      // handleZapierApiRequest. Admin routes retain their separate access
      // policy below.
      if (url.pathname.startsWith("/api/zapier/v1/")) {
        return await handleZapierApiRequest(request, url, env);
      }

      const identity = await requireAccessIdentity(request, env, "employee");

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
  if (url.pathname === "/api/admin/v1/dashboard/overview") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse({
      ...(await getDashboardOverview(
        env,
        parseDashboardOverviewQuery(url)
      )),
      access: dashboardAccessSummary(identity)
    });
  }

  if (url.pathname === "/api/admin/v1/dashboard/activity") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse(
      await listDashboardActivities(env, parseDashboardActivityQuery(url))
    );
  }

  if (url.pathname === "/api/admin/v1/dashboard/records") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse(
      await listDashboardRecords(env, parseDashboardRecordQuery(url))
    );
  }

  const dashboardRecordMatch =
    /^\/api\/admin\/v1\/dashboard\/records\/([0-9a-f]{32})$/u.exec(
      url.pathname
    );
  if (dashboardRecordMatch?.[1]) {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }
    return jsonResponse(
      await getDashboardRecord(
        env,
        parseDashboardRecordDetailQuery(url),
        requireDashboardPublicId(dashboardRecordMatch[1])
      )
    );
  }

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

  if (url.pathname === "/api/admin/v1/snapshots") {
    if (request.method !== "GET") {
      methodNotAllowed(["GET"]);
    }

    const area = url.searchParams.get("area") ?? "";
    if (!MATOOL_SNAPSHOT_AREAS.includes(area as never)) {
      throw new AppError(
        "unknown_matool_area",
        400,
        "Dieser MATOOL-Bereich ist nicht freigegeben."
      );
    }

    const rawLimit = Number.parseInt(
      url.searchParams.get("limit") ?? "100",
      10
    );
    const limit = Number.isFinite(rawLimit)
      ? Math.min(500, Math.max(1, rawLimit))
      : 100;

    // Bis zur spaeteren Rollen- und Feldfreigabe liefert dieser Alt-Endpunkt
    // fuer jede Identitaet ausschliesslich serverseitig maskierte Werte.
    return jsonResponse(await listAreaSnapshots(env, area, limit));
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

  if (
    url.pathname ===
    "/api/admin/v1/matool/interessenten/extract"
  ) {
    await requireValidCsrfRequest(request, identity, env);
    await parseMatoolExtractBody(request);

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
        "Passwortrotation und read-only-Datenauszug müssen zuerst bestätigt werden."
      );
    }

    const client = new MatoolClient(env.MATOOL_BASE_URL);
    try {
      const extraction = await client.extractInteressenten({
        email: env.MATOOL_EMAIL,
        password: env.MATOOL_PASSWORD
      });
      return jsonResponse({
        schemaVersion: 1,
        extraction
      });
    } finally {
      client.clearSession();
    }
  }

  if (url.pathname === "/api/admin/v1/matool/discovery") {
    await requireValidCsrfRequest(request, identity, env);
    const bereich = await parseMatoolDiscoveryBody(request);

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
      const discovery = await client.discoverStructure(
        {
          email: env.MATOOL_EMAIL,
          password: env.MATOOL_PASSWORD
        },
        bereich
      );
      return jsonResponse({
        schemaVersion: 1,
        discovery
      });
    } finally {
      client.clearSession();
    }
  }

  if (url.pathname === "/api/admin/v1/matool/sync") {
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

    const result = await collectMatoolSnapshots(env, Date.now());
    return jsonResponse({
      schemaVersion: 1,
      sync: result
    });
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

async function parseMatoolExtractBody(request: Request): Promise<void> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError(
      "invalid_matool_extract_body",
      400,
      "Die Auszugsanfrage enthält kein gültiges JSON."
    );
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  ) {
    throw new AppError(
      "invalid_matool_extract_body",
      400,
      "Die Auszugsanfrage erwartet ausschließlich ein leeres JSON-Objekt."
    );
  }
}

async function parseMatoolDiscoveryBody(
  request: Request
): Promise<"interessenten"> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError(
      "invalid_matool_body",
      400,
      "Die Discovery-Anfrage enthält kein gültiges JSON."
    );
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "bereich")
  ) {
    throw new AppError(
      "invalid_matool_body",
      400,
      "Die Discovery-Anfrage erwartet ausschließlich das Feld 'bereich'."
    );
  }

  const bereich = (body as { bereich?: unknown }).bereich;
  if (typeof bereich !== "string") {
    throw new AppError(
      "invalid_matool_body",
      400,
      "Das Feld 'bereich' muss eine Zeichenfolge sein."
    );
  }

  if (bereich !== "interessenten") {
    throw new AppError(
      "invalid_matool_bereich",
      400,
      "Aktuell kann nur der Bereich 'interessenten' erkannt werden."
    );
  }

  return bereich;
}

export default worker;
