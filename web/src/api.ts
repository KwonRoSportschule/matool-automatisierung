import type {
  DashboardActivityResponse,
  DashboardOverview,
  DashboardRecordDetail,
  DashboardRecordsResponse,
  DiscoveryResponse,
  PrivacySummary,
  SyncResponse
} from "./types";

export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ActivityQuery {
  area: string;
  from: string;
  kind: string;
  page: number;
  pageSize: number;
  status: string;
  to: string;
}

export interface RecordsQuery {
  area: string;
  change: string;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  query: string;
  sort: string;
}

export function getOverview(
  range: 1 | 7 | 30 | 90,
  signal?: AbortSignal
): Promise<DashboardOverview> {
  return getMaskedJson<DashboardOverview>(
    `/api/admin/v1/dashboard/overview?range=${range}`,
    signal
  );
}

export function getActivity(
  query: ActivityQuery,
  signal?: AbortSignal
): Promise<DashboardActivityResponse> {
  const parameters = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize)
  });
  addIfPresent(parameters, "status", query.status);
  addIfPresent(parameters, "area", query.area);
  addIfPresent(parameters, "kind", query.kind);
  addIfPresent(parameters, "from", query.from);
  addIfPresent(parameters, "to", query.to);
  return getMaskedJson<DashboardActivityResponse>(
    `/api/admin/v1/dashboard/activity?${parameters.toString()}`,
    signal
  );
}

export function getRecords(
  query: RecordsQuery,
  signal?: AbortSignal
): Promise<DashboardRecordsResponse> {
  const parameters = new URLSearchParams({
    area: query.area,
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    direction: query.direction,
    change: query.change
  });
  addIfPresent(parameters, "q", query.query.trim());
  return getMaskedJson<DashboardRecordsResponse>(
    `/api/admin/v1/dashboard/records?${parameters.toString()}`,
    signal
  );
}

export function getRecordDetail(
  area: string,
  publicId: string,
  signal?: AbortSignal
): Promise<DashboardRecordDetail> {
  const parameters = new URLSearchParams({ area });
  return getMaskedJson<DashboardRecordDetail>(
    `/api/admin/v1/dashboard/records/${encodeURIComponent(publicId)}?${parameters.toString()}`,
    signal
  );
}

export async function runMatoolSync(): Promise<SyncResponse> {
  const csrf = await requestJson<{ token: string }>("/api/admin/v1/csrf");
  return requestJson<SyncResponse>("/api/admin/v1/matool/sync", {
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.token
    },
    method: "POST"
  });
}

export async function runDiscovery(area: string): Promise<DiscoveryResponse> {
  const csrf = await requestJson<{ token: string }>("/api/admin/v1/csrf");
  return requestJson<DiscoveryResponse>("/api/admin/v1/matool/discovery", {
    body: JSON.stringify({ bereich: area }),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.token
    },
    method: "POST"
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function getMaskedJson<T extends { privacy: PrivacySummary }>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const payload = await requestJson<T>(
    path,
    signal ? { signal } : undefined
  );
  // Entscheidend ist, dass der Server über die Sichtbarkeit entscheidet.
  // Ob er dabei maskiert oder — wie in der Testphase — Klartext liefert,
  // steuert der Schalter PUBLIC_DASHBOARD_PLAINTEXT im Worker.
  if (payload.privacy.mode !== "server-side") {
    throw new ApiError(
      "Die Datenschutzprüfung ist fehlgeschlagen. Es werden vorsorglich keine Datensätze angezeigt.",
      503,
      "dashboard_privacy_not_enforced"
    );
  }
  return payload;
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) {
        throw new ApiError(
          `Der Hub antwortet momentan nicht korrekt (${response.status}).`,
          response.status
        );
      }
      throw new ApiError(
        "Der Hub hat eine unverständliche Antwort geliefert.",
        502,
        "invalid_json_response"
      );
    }
  }

  if (!response.ok) {
    const error = readError(payload);
    throw new ApiError(
      error.message ?? `Die Anfrage ist fehlgeschlagen (${response.status}).`,
      response.status,
      error.code
    );
  }
  return payload as T;
}

function readError(payload: unknown): { code: string | null; message: string | null } {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { code: null, message: null };
  }
  return {
    code: typeof payload.error.code === "string" ? payload.error.code : null,
    message:
      typeof payload.error.message === "string" ? payload.error.message : null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIfPresent(
  parameters: URLSearchParams,
  key: string,
  value: string
): void {
  if (value.length > 0) {
    parameters.set(key, value);
  }
}
