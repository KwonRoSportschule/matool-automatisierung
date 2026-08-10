import { AppError } from "../core/app-error";
import type {
  DashboardActivityQuery,
  DashboardRecordQuery
} from "./dashboard-repository";
import { MATOOL_SNAPSHOT_AREAS } from "./schedule";

const PAGE_SIZES = new Set([10, 25, 50, 100]);
const OVERVIEW_RANGES = new Set([1, 7, 30, 90]);
const ACTIVITY_STATUSES = new Set([
  "failed",
  "info",
  "running",
  "skipped",
  "succeeded",
  "warning"
]);
const ACTIVITY_KINDS = new Set(["automation", "data", "sync", "zapier"]);
const RECORD_CHANGES = new Set(["all", "created", "updated"]);
const RECORD_SORTS = new Set([
  "firstSeenAt",
  "lastChangedAt",
  "lastSeenAt",
  "recordRef"
]);
const DIRECTIONS = new Set(["asc", "desc"]);

export function parseDashboardOverviewQuery(url: URL): 1 | 7 | 30 | 90 {
  requireAllowedParameters(url.searchParams, ["range"]);
  const value = optionalSingle(url.searchParams, "range") ?? "7";
  const range = strictInteger(value, "range", 1, 90);
  if (!OVERVIEW_RANGES.has(range)) {
    invalidQuery("Der Zeitraum muss 1, 7, 30 oder 90 Tage betragen.");
  }
  return range as 1 | 7 | 30 | 90;
}

export function parseDashboardActivityQuery(url: URL): DashboardActivityQuery {
  requireAllowedParameters(url.searchParams, [
    "area",
    "from",
    "kind",
    "page",
    "pageSize",
    "status",
    "to"
  ]);
  const page = parsePage(url.searchParams);
  const pageSize = parsePageSize(url.searchParams);
  const area = optionalSingle(url.searchParams, "area");
  const kind = optionalSingle(url.searchParams, "kind");
  const status = optionalSingle(url.searchParams, "status");
  const from = parseDateParameter(url.searchParams, "from");
  const to = parseDateParameter(url.searchParams, "to");

  if (area && !MATOOL_SNAPSHOT_AREAS.includes(area as never)) {
    invalidQuery("Dieser Datenbereich ist nicht freigegeben.");
  }
  if (kind && !ACTIVITY_KINDS.has(kind)) {
    invalidQuery("Diese Aktivitaetsart ist nicht freigegeben.");
  }
  if (status && !ACTIVITY_STATUSES.has(status)) {
    invalidQuery("Dieser Aktivitaetsstatus ist nicht freigegeben.");
  }
  if (from && to && from > to) {
    invalidQuery("Der Beginn des Zeitraums muss vor seinem Ende liegen.");
  }

  // Einzelzuweisung statt konditionalem Spreading: Unter
  // exactOptionalPropertyTypes leitet TypeScript aus dem Spread
  // "string | undefined" ab, was zu einem optionalen "string" nicht passt.
  const query: DashboardActivityQuery = { page, pageSize };
  if (area) {
    query.area = area;
  }
  if (from) {
    query.from = from;
  }
  if (kind) {
    query.kind = kind as NonNullable<DashboardActivityQuery["kind"]>;
  }
  if (status) {
    query.status = status as NonNullable<DashboardActivityQuery["status"]>;
  }
  if (to) {
    query.to = to;
  }
  return query;
}

export function parseDashboardRecordQuery(url: URL): DashboardRecordQuery {
  requireAllowedParameters(url.searchParams, [
    "area",
    "change",
    "direction",
    "page",
    "pageSize",
    "q",
    "sort"
  ]);
  const area = requiredSingle(url.searchParams, "area");
  const change = optionalSingle(url.searchParams, "change") ?? "all";
  const direction = optionalSingle(url.searchParams, "direction") ?? "desc";
  const query = optionalSingle(url.searchParams, "q") ?? "";
  const sort = optionalSingle(url.searchParams, "sort") ?? "lastSeenAt";

  if (!MATOOL_SNAPSHOT_AREAS.includes(area as never)) {
    invalidQuery("Dieser Datenbereich ist nicht freigegeben.");
  }
  if (!RECORD_CHANGES.has(change)) {
    invalidQuery("Dieser Aenderungsfilter ist nicht freigegeben.");
  }
  if (!DIRECTIONS.has(direction)) {
    invalidQuery("Diese Sortierrichtung ist nicht freigegeben.");
  }
  if (!RECORD_SORTS.has(sort)) {
    invalidQuery("Dieses Sortierfeld ist nicht freigegeben.");
  }
  if (query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query)) {
    invalidQuery("Der Suchbegriff ist ungueltig oder zu lang.");
  }

  return {
    area,
    change: change as DashboardRecordQuery["change"],
    direction: direction as DashboardRecordQuery["direction"],
    page: parsePage(url.searchParams),
    pageSize: parsePageSize(url.searchParams),
    query,
    sort: sort as DashboardRecordQuery["sort"]
  };
}

export function parseDashboardRecordDetailQuery(url: URL): string {
  requireAllowedParameters(url.searchParams, ["area"]);
  const area = requiredSingle(url.searchParams, "area");
  if (!MATOOL_SNAPSHOT_AREAS.includes(area as never)) {
    invalidQuery("Dieser Datenbereich ist nicht freigegeben.");
  }
  return area;
}

function parsePage(parameters: URLSearchParams): number {
  return strictInteger(optionalSingle(parameters, "page") ?? "1", "page", 1, 1_000_000);
}

function parsePageSize(parameters: URLSearchParams): number {
  const value = strictInteger(
    optionalSingle(parameters, "pageSize") ?? "25",
    "pageSize",
    10,
    100
  );
  if (!PAGE_SIZES.has(value)) {
    invalidQuery("Die Seitengroesse muss 10, 25, 50 oder 100 betragen.");
  }
  return value;
}

function parseDateParameter(
  parameters: URLSearchParams,
  key: "from" | "to"
): string | undefined {
  const value = optionalSingle(parameters, key);
  if (!value) {
    return undefined;
  }
  if (value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    invalidQuery("Der Zeitraum enthaelt kein gueltiges ISO-Datum.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    invalidQuery("Der Zeitraum enthaelt kein gueltiges ISO-Datum.");
  }
  return new Date(parsed).toISOString();
}

function strictInteger(
  value: string,
  key: string,
  minimum: number,
  maximum: number
): number {
  if (!/^\d+$/u.test(value)) {
    invalidQuery(`Der Parameter '${key}' muss eine ganze Zahl sein.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalidQuery(`Der Parameter '${key}' liegt ausserhalb des erlaubten Bereichs.`);
  }
  return parsed;
}

function requireAllowedParameters(
  parameters: URLSearchParams,
  allowed: readonly string[]
): void {
  const allowedSet = new Set(allowed);
  for (const key of parameters.keys()) {
    if (!allowedSet.has(key) || parameters.getAll(key).length !== 1) {
      invalidQuery("Die Dashboard-Abfrage enthaelt unbekannte oder doppelte Parameter.");
    }
  }
}

function requiredSingle(parameters: URLSearchParams, key: string): string {
  const value = optionalSingle(parameters, key);
  if (!value) {
    invalidQuery(`Der Parameter '${key}' ist erforderlich.`);
  }
  return value;
}

function optionalSingle(
  parameters: URLSearchParams,
  key: string
): string | undefined {
  const values = parameters.getAll(key);
  if (values.length > 1) {
    invalidQuery("Die Dashboard-Abfrage enthaelt doppelte Parameter.");
  }
  const value = values[0]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function invalidQuery(message: string): never {
  throw new AppError("invalid_dashboard_query", 400, message);
}
