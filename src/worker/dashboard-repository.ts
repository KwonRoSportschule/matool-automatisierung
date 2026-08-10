import { AppError } from "../core/app-error";
import { FIRST_TRIAL_COLLECTOR } from "../core/first-trial";
import {
  PROTECTED_DASHBOARD_VALUE,
  areaLabel,
  dashboardColumns,
  dashboardFieldValues,
  dashboardValues,
  parseStoredPayload,
  searchableDashboardFields
} from "./dashboard-privacy";
import type { Env } from "./env";
import { MATOOL_SNAPSHOT_AREAS } from "./schedule";
import { getBerlinScheduleSummary } from "./schedule-window";

export type DashboardState =
  | "healthy"
  | "warning"
  | "critical"
  | "inactive"
  | "unknown";

export interface DashboardRecordQuery {
  area: string;
  change: "all" | "created" | "updated";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  query: string;
  sort: "firstSeenAt" | "lastChangedAt" | "lastSeenAt" | "recordRef";
}

export interface DashboardActivityQuery {
  area?: string;
  from?: string;
  kind?: "automation" | "data" | "sync" | "zapier";
  page: number;
  pageSize: number;
  status?: "failed" | "info" | "running" | "skipped" | "succeeded" | "warning";
  to?: string;
}

interface ProcessRow {
  display_name: string;
  mode: "active" | "disabled" | "dry_run" | "shadow";
  updated_at: string;
}

interface AreaCountRow {
  area: string;
  first_seen_at: string | null;
  last_changed_at: string | null;
  last_seen_at: string | null;
  stored_count: number;
}

interface AreaRunRow {
  area: string;
  error_code: string | null;
  failure_count: number;
  fetched_count: number;
  finished_at: string;
  run_id: string;
  started_at: string;
  status: "failed" | "succeeded";
  success_count: number;
}

interface AreaChangeCountRow {
  area: string;
  changed_count: number;
  new_count: number;
}

interface SyncTotalsRow {
  changed_count: number;
  failed_count: number;
  new_count: number;
  successful_count: number;
}

interface HourlyRunRow {
  bucket: string;
  count: number;
  status: string;
}

interface HourlyChangeRow {
  bucket: string;
  change_kind: "created" | "updated";
  count: number;
}

interface SyncRow {
  changed_count: number;
  error_code: string | null;
  failed_area_count: number;
  finished_at: string | null;
  new_count: number;
  scheduled_for: string | null;
  started_at: string;
  status: "failed" | "partial_failed" | "running" | "skipped" | "succeeded";
  stored_count: number;
  succeeded_area_count: number;
  sync_id: string;
  trigger_kind: "manual" | "scheduled";
}

interface CountRow {
  count: number;
}

interface EventSummaryRow {
  created_at: string;
  event_type: string;
  status: string;
}

interface DeliverySummaryRow {
  finished_at: string;
  http_status: number | null;
  outcome: string;
}

const localDayFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
  year: "numeric"
});

export async function getDashboardOverview(
  env: Env,
  rangeDays: 1 | 7 | 30 | 90,
  now = new Date()
): Promise<Record<string, unknown>> {
  const generatedAt = now.toISOString();
  const from = new Date(now.getTime() - rangeDays * 86_400_000).toISOString();
  const schedule = getBerlinScheduleSummary(now);

  try {
    const [
      process,
      areaCounts,
      latestAreaRuns,
      latestSuccessfulAreaRuns,
      areaChangeCounts,
      syncTotals,
      hourlyRuns,
      hourlyChanges,
      lastSync,
      lastScheduledSync,
      activeSubscriptions,
      unconfirmedClaims,
      pendingOutbox,
      lastEvent,
      lastDelivery
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT display_name, mode, updated_at
         FROM process_config
         WHERE process_key = ?`
      ).bind(FIRST_TRIAL_COLLECTOR).first<ProcessRow>(),
      env.DB.prepare(
        `SELECT area,
                COUNT(*) AS stored_count,
                MIN(first_seen_at) AS first_seen_at,
                MAX(last_seen_at) AS last_seen_at,
                MAX(last_changed_at) AS last_changed_at
         FROM matool_snapshots
         GROUP BY area`
      ).all<AreaCountRow>(),
      env.DB.prepare(latestAreaRunSql(false)).all<AreaRunRow>(),
      env.DB.prepare(latestAreaRunSql(true)).all<AreaRunRow>(),
      env.DB.prepare(
        `SELECT area,
                SUM(CASE WHEN change_kind = 'created' THEN 1 ELSE 0 END) AS new_count,
                SUM(CASE WHEN change_kind = 'updated' THEN 1 ELSE 0 END) AS changed_count
         FROM matool_snapshot_changes
         WHERE observed_at >= ?
         GROUP BY area`
      ).bind(from).all<AreaChangeCountRow>(),
      env.DB.prepare(
        `SELECT
           SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS successful_count,
           SUM(CASE WHEN status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END) AS failed_count,
           COALESCE(SUM(new_count), 0) AS new_count,
           COALESCE(SUM(changed_count), 0) AS changed_count
         FROM matool_sync_runs
         WHERE started_at >= ?
           AND status <> 'skipped'`
      ).bind(from).first<SyncTotalsRow>(),
      env.DB.prepare(
        `SELECT strftime('%Y-%m-%dT%H:00:00.000Z', started_at) AS bucket,
                status,
                COUNT(*) AS count
         FROM matool_sync_runs
         WHERE started_at >= ?
           AND status <> 'skipped'
         GROUP BY bucket, status
         ORDER BY bucket`
      ).bind(from).all<HourlyRunRow>(),
      env.DB.prepare(
        `SELECT strftime('%Y-%m-%dT%H:00:00.000Z', observed_at) AS bucket,
                change_kind,
                COUNT(*) AS count
         FROM matool_snapshot_changes
         WHERE observed_at >= ?
         GROUP BY bucket, change_kind
         ORDER BY bucket`
      ).bind(from).all<HourlyChangeRow>(),
      env.DB.prepare(
        `SELECT sync_id, trigger_kind, scheduled_for, started_at, finished_at,
                status, succeeded_area_count, failed_area_count, stored_count,
                new_count, changed_count, error_code
         FROM matool_sync_runs
         ORDER BY started_at DESC
         LIMIT 1`
      ).first<SyncRow>(),
      env.DB.prepare(
        `SELECT sync_id, trigger_kind, scheduled_for, started_at, finished_at,
                status, succeeded_area_count, failed_area_count, stored_count,
                new_count, changed_count, error_code
         FROM matool_sync_runs
         WHERE trigger_kind = 'scheduled'
           AND status <> 'skipped'
         ORDER BY scheduled_for DESC
         LIMIT 1`
      ).first<SyncRow>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM zapier_subscriptions
         WHERE status = 'active'`
      ).first<CountRow>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM event_claims
         WHERE confirmed_at IS NULL
           AND datetime(review_after) <= CURRENT_TIMESTAMP`
      ).first<CountRow>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM outbox
         WHERE status IN ('pending', 'in_flight', 'retry_wait', 'permanent_failure')`
      ).first<CountRow>(),
      env.DB.prepare(
        `SELECT event_type, status, created_at
         FROM events
         ORDER BY created_at DESC
         LIMIT 1`
      ).first<EventSummaryRow>(),
      env.DB.prepare(
        `SELECT outcome, http_status, finished_at
         FROM deliveries
         ORDER BY finished_at DESC
         LIMIT 1`
      ).first<DeliverySummaryRow>()
    ]);

    const latestRunByArea = new Map(
      latestAreaRuns.results.map((row) => [row.area, row])
    );
    const latestSuccessByArea = new Map(
      latestSuccessfulAreaRuns.results.map((row) => [row.area, row])
    );
    const countsByArea = new Map(
      areaCounts.results.map((row) => [row.area, row])
    );
    const changesByArea = new Map(
      areaChangeCounts.results.map((row) => [row.area, row])
    );
    const previousScheduledMs = Date.parse(schedule.previousScheduledAt);

    const areas = MATOOL_SNAPSHOT_AREAS.map((area) => {
      const counts = countsByArea.get(area);
      const lastRun = latestRunByArea.get(area);
      const lastSuccess = latestSuccessByArea.get(area);
      const changes = changesByArea.get(area);
      const state = areaState(lastRun, lastSuccess, previousScheduledMs);
      return {
        key: area,
        label: areaLabel(area),
        state,
        storedCount: counts?.stored_count ?? 0,
        currentCount: lastSuccess?.success_count ?? 0,
        newCount: changes?.new_count ?? 0,
        changedCount: changes?.changed_count ?? 0,
        firstSeenAt: counts?.first_seen_at ?? null,
        lastObservedAt: counts?.last_seen_at ?? null,
        lastChangedAt: counts?.last_changed_at ?? null,
        lastRun: mapAreaRun(lastRun),
        lastSuccessfulRun: mapAreaRun(lastSuccess)
      };
    });

    const matool = matoolConnection(
      env,
      latestAreaRuns.results,
      latestSuccessfulAreaRuns.results,
      generatedAt,
      previousScheduledMs
    );
    const scheduleCard = scheduleConnection(
      schedule,
      lastScheduledSync,
      generatedAt
    );
    const zapier = zapierConnection(env, {
      activeSubscriptions: activeSubscriptions?.count ?? 0,
      lastDelivery: lastDelivery ?? null,
      lastEvent: lastEvent ?? null,
      pendingOutbox: pendingOutbox?.count ?? 0,
      unconfirmedClaims: unconfirmedClaims?.count ?? 0
    });
    const database = {
      key: "database",
      label: "Cloudflare D1",
      state: "healthy" as const,
      statusLabel: "Erreichbar",
      checkedAt: generatedAt,
      lastSuccessAt: generatedAt,
      lastActivityAt:
        areas.map((area) => area.lastObservedAt).filter(Boolean).sort().at(-1) ?? null,
      lastError: null,
      description: "Die Betriebsdatenbank antwortet und alle Dashboard-Abfragen konnten ausgefuehrt werden.",
      action: null
    };

    const warnings = buildWarnings(matool, scheduleCard, areas, zapier);
    const overall = deriveOverall(
      [matool, database, scheduleCard, zapier, ...areas],
      warnings
    );
    const totalStored = areas.reduce((sum, area) => sum + area.storedCount, 0);
    const totals = syncTotals ?? {
      changed_count: 0,
      failed_count: 0,
      new_count: 0,
      successful_count: 0
    };

    return {
      schemaVersion: 2,
      generatedAt,
      environment: env.APP_ENV,
      privacy: dashboardPrivacyNotice(env),
      range: { days: rangeDays, from, to: generatedAt },
      overall,
      connections: { matool, database, schedule: scheduleCard, zapier },
      metrics: {
        storedRecords: totalStored,
        monitoredAreas: MATOOL_SNAPSHOT_AREAS.length,
        areasWithData: areas.filter((area) => area.storedCount > 0).length,
        successfulRuns: totals.successful_count ?? 0,
        failedRuns: totals.failed_count ?? 0,
        newRecords: totals.new_count ?? 0,
        changedRecords: totals.changed_count ?? 0
      },
      charts: buildChartSeries(
        from,
        generatedAt,
        hourlyRuns.results,
        hourlyChanges.results
      ),
      areas,
      schedule: {
        ...schedule,
        technicalCron: "0 7-18 * * mon-fri",
        lastActualAt: lastScheduledSync?.started_at ?? null,
        lastCompletedAt: lastScheduledSync?.finished_at ?? null,
        lastStatus: lastScheduledSync?.status ?? null,
        affectedAreas: [...MATOOL_SNAPSHOT_AREAS]
      },
      functions: buildFunctionCatalogue(env, process, lastSync, lastScheduledSync),
      warnings
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "dashboard_unavailable",
      503,
      "Das Hub-Kontrollzentrum kann momentan nicht geladen werden."
    );
  }
}

function latestAreaRunSql(successOnly: boolean): string {
  return `WITH ranked AS (
    SELECT run_id, area, status, started_at, finished_at, fetched_count,
           success_count, failure_count, error_code,
           ROW_NUMBER() OVER (PARTITION BY area ORDER BY started_at DESC) AS position
    FROM matool_snapshot_runs
    ${successOnly ? "WHERE status = 'succeeded'" : ""}
  )
  SELECT run_id, area, status, started_at, finished_at, fetched_count,
         success_count, failure_count, error_code
  FROM ranked
  WHERE position = 1`;
}

function mapAreaRun(row: AreaRunRow | undefined): unknown {
  return row
    ? {
        id: row.run_id,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        fetchedCount: row.fetched_count,
        successCount: row.success_count,
        failureCount: row.failure_count,
        errorCode: row.error_code
      }
    : null;
}

function areaState(
  lastRun: AreaRunRow | undefined,
  lastSuccess: AreaRunRow | undefined,
  previousScheduledMs: number
): DashboardState {
  if (!lastRun) {
    return "unknown";
  }
  if (lastRun.status === "failed") {
    return "critical";
  }
  if (!lastSuccess || Date.parse(lastSuccess.started_at) < previousScheduledMs - 7_200_000) {
    return "warning";
  }
  return "healthy";
}

function matoolConnection(
  env: Env,
  latestRuns: readonly AreaRunRow[],
  successfulRuns: readonly AreaRunRow[],
  checkedAt: string,
  previousScheduledMs: number
): Record<string, unknown> & { state: DashboardState } {
  const configured = Boolean(env.MATOOL_EMAIL && env.MATOOL_PASSWORD);
  const lastRun = [...latestRuns].sort((left, right) => right.started_at.localeCompare(left.started_at))[0];
  const lastSuccess = [...successfulRuns].sort((left, right) => right.started_at.localeCompare(left.started_at))[0];
  const lastFailure = [...latestRuns]
    .filter((row) => row.status === "failed")
    .sort((left, right) => right.started_at.localeCompare(left.started_at))[0];

  let state: DashboardState = "unknown";
  let statusLabel = "Noch nicht bestaetigt";
  let action: string | null = "Ersten erfolgreichen MATOOL-Abruf pruefen.";
  if (!configured || env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
    state = "critical";
    statusLabel = "Nicht betriebsbereit";
    action = "MATOOL-Konfiguration und Read-only-Freigabe pruefen.";
  } else if (lastRun?.status === "failed") {
    state = "critical";
    statusLabel = "Letzter Abruf fehlgeschlagen";
    action = "Fehlercode des letzten Abrufs pruefen.";
  } else if (lastSuccess && Date.parse(lastSuccess.started_at) >= previousScheduledMs - 7_200_000) {
    state = "healthy";
    statusLabel = "Verbunden und aktuell";
    action = null;
  } else if (lastSuccess) {
    state = "warning";
    statusLabel = "Daten sind veraltet";
    action = "Naechsten automatischen Lauf beobachten.";
  }

  return {
    key: "matool",
    label: "MATOOL",
    state,
    statusLabel,
    configured,
    checkedAt,
    lastSuccessAt: lastSuccess?.finished_at ?? null,
    lastActivityAt: lastRun?.finished_at ?? null,
    lastError: lastFailure
      ? { at: lastFailure.finished_at, code: lastFailure.error_code }
      : null,
    description:
      "Die Verbindung wird aus den tatsaechlichen read-only Datenabrufen abgeleitet, nicht nur aus vorhandenen Zugangsdaten.",
    action
  };
}

function scheduleConnection(
  schedule: ReturnType<typeof getBerlinScheduleSummary>,
  lastRun: SyncRow | null,
  checkedAt: string
): Record<string, unknown> & { state: DashboardState } {
  const previousMs = Date.parse(schedule.previousScheduledAt);
  const actualMs = lastRun ? Date.parse(lastRun.started_at) : Number.NaN;
  const scheduledMs = lastRun?.scheduled_for
    ? Date.parse(lastRun.scheduled_for)
    : Number.NaN;
  const representsLatestWindow =
    Number.isFinite(scheduledMs) && scheduledMs >= previousMs - 7_200_000;
  const delayMinutes =
    Number.isFinite(actualMs) && Number.isFinite(scheduledMs)
      ? Math.max(0, Math.round((actualMs - scheduledMs) / 60_000))
      : lastRun && !representsLatestWindow
        ? Math.max(
            0,
            Math.round((Date.parse(checkedAt) - previousMs) / 60_000)
          )
        : null;
  let state: DashboardState = "unknown";
  let statusLabel = "Noch kein geplanter Lauf";
  let action: string | null = "Den naechsten geplanten Lauf beobachten.";
  if (lastRun?.status === "failed") {
    state = "critical";
    statusLabel = "Geplanter Lauf fehlgeschlagen";
    action = "Fehler des letzten Gesamtlaufs pruefen.";
  } else if (lastRun?.status === "partial_failed") {
    state = "warning";
    statusLabel = "Geplanter Lauf teilweise fehlgeschlagen";
    action = "Fehlgeschlagene Datenbereiche pruefen.";
  } else if (lastRun && representsLatestWindow) {
    state = "healthy";
    statusLabel = "Zeitplan arbeitet";
    action = null;
  } else if (lastRun) {
    state = "warning";
    statusLabel = "Letzter Lauf ist verspätet";
  }

  return {
    key: "schedule",
    label: "Automatischer Zeitplan",
    state,
    statusLabel,
    checkedAt,
    lastSuccessAt: lastRun?.status === "succeeded" ? lastRun.finished_at : null,
    lastActivityAt: lastRun?.started_at ?? null,
    lastError:
      lastRun?.status === "failed" || lastRun?.status === "partial_failed"
        ? { at: lastRun.finished_at, code: lastRun.error_code }
        : null,
    description: schedule.description,
    action,
    previousScheduledAt: schedule.previousScheduledAt,
    nextScheduledAt: schedule.nextScheduledAt,
    lastActualAt: lastRun?.started_at ?? null,
    delayMinutes
  };
}

function zapierConnection(
  env: Env,
  input: {
    activeSubscriptions: number;
    lastDelivery: DeliverySummaryRow | null;
    lastEvent: EventSummaryRow | null;
    pendingOutbox: number;
    unconfirmedClaims: number;
  }
): Record<string, unknown> & { state: DashboardState } {
  const configured = Boolean(env.ZAPIER_SERVICE_TOKEN);
  const outboundEnabled = env.OUTBOUND_DELIVERY_ENABLED === "true";
  const hasProblem =
    outboundEnabled && (input.pendingOutbox > 0 || input.unconfirmedClaims > 0);
  const state: DashboardState = hasProblem
    ? "warning"
    : configured
      ? "healthy"
      : "inactive";
  const statusLabel = !configured
    ? "Nicht eingerichtet"
    : !outboundEnabled
      ? "Datenabholung bereit"
      : hasProblem
        ? "Pruefung erforderlich"
        : "Ausgabe aktiv";
  const description = !configured
    ? "Der Zapier-Service-Token fuer die Read-only-Datenabholung fehlt."
    : !outboundEnabled
      ? "Die Read-only-Datenabholung ist bereit; Kontakt und ausgehende Zustellung bleiben absichtlich ausgeschaltet."
      : "Zapier-Ereignisse duerfen verarbeitet werden.";
  return {
    key: "zapier",
    label: "Zapier",
    state,
    statusLabel,
    configured,
    checkedAt: new Date().toISOString(),
    lastSuccessAt:
      input.lastDelivery?.outcome === "accepted"
        ? input.lastDelivery.finished_at
        : null,
    lastActivityAt:
      input.lastDelivery?.finished_at ?? input.lastEvent?.created_at ?? null,
    lastError:
      input.lastDelivery && input.lastDelivery.outcome !== "accepted"
        ? {
            at: input.lastDelivery.finished_at,
            code: input.lastDelivery.outcome,
            httpStatus: input.lastDelivery.http_status
          }
        : null,
    description,
    action: hasProblem
      ? "Offene Zapier-Vorgaenge pruefen."
      : configured
        ? null
        : "Zapier-Service-Token einrichten.",
    activeSubscriptions: input.activeSubscriptions,
    pendingOutbox: input.pendingOutbox,
    unconfirmedClaims: input.unconfirmedClaims,
    outboundEnabled
  };
}

function buildWarnings(
  matool: Record<string, unknown> & { state: DashboardState },
  schedule: Record<string, unknown> & { state: DashboardState },
  areas: ReadonlyArray<{ key: string; label: string; state: DashboardState; lastRun: unknown }>,
  zapier: Record<string, unknown> & { state: DashboardState }
): unknown[] {
  const warnings: unknown[] = [];
  for (const connection of [matool, schedule, zapier]) {
    if (connection.state === "warning" || connection.state === "critical") {
      warnings.push({
        key: `${connection.key}_state`,
        state: connection.state,
        title: `${connection.label}: ${connection.statusLabel}`,
        impact:
          connection.state === "critical"
            ? "Aktuelle Daten koennen fehlen."
            : "Ein Teil des Betriebs sollte kontrolliert werden.",
        action: connection.action,
        occurredAt: connection.lastActivityAt ?? connection.checkedAt,
        technicalCode:
          (connection.lastError as { code?: string } | null)?.code ?? null
      });
    }
  }
  for (const area of areas.filter(
    (entry) => entry.state === "warning" || entry.state === "critical"
  )) {
    warnings.push({
      key: `area_${area.key}`,
      state: area.state,
      title: `${area.label}: letzter Abruf pruefen`,
      impact: "Der Datenbereich kann unvollstaendig oder veraltet sein.",
      action: "Laufstatus und Fehlercode im Aktivitaetsverlauf pruefen.",
      occurredAt: null,
      technicalCode: null
    });
  }
  return warnings;
}

function deriveOverall(
  connections: ReadonlyArray<{ state: DashboardState }>,
  warnings: readonly unknown[]
): unknown {
  const critical = connections.filter((entry) => entry.state === "critical").length;
  const warning = connections.filter((entry) => entry.state === "warning").length;
  const unknown = connections.filter((entry) => entry.state === "unknown").length;
  if (critical > 0) {
    return {
      state: "critical",
      label: "Handlungsbedarf",
      summary: "Mindestens ein wichtiger Teil des Hubs ist ausgefallen oder nicht aktuell.",
      reasonCount: critical,
      recommendedAction: "Die roten Statuskarten und Warnungen zuerst pruefen."
    };
  }
  if (warning > 0 || warnings.length > 0) {
    return {
      state: "warning",
      label: "Betrieb mit Warnungen",
      summary: "Der Hub arbeitet, einzelne Bereiche benoetigen jedoch Aufmerksamkeit.",
      reasonCount: Math.max(warning, warnings.length),
      recommendedAction: "Gelbe Hinweise im Verlauf kontrollieren."
    };
  }
  if (unknown > 0) {
    return {
      state: "unknown",
      label: "Status noch unklar",
      summary: "Fuer mindestens einen wichtigen Teil fehlen noch verlaessliche Laufdaten.",
      reasonCount: unknown,
      recommendedAction: "Den naechsten automatischen Lauf abwarten."
    };
  }
  return {
    state: "healthy",
    label: "Hub arbeitet ordnungsgemaess",
    summary: "Datenbank, MATOOL-Abruf und Zeitplan melden einen aktuellen Zustand.",
    reasonCount: 0,
    recommendedAction: null
  };
}

function buildChartSeries(
  from: string,
  to: string,
  runs: readonly HourlyRunRow[],
  changes: readonly HourlyChangeRow[]
): unknown {
  const byDay = new Map<string, {
    changed: number;
    failed: number;
    label: string;
    new: number;
    successful: number;
  }>();
  const cursor = new Date(from);
  cursor.setUTCHours(12, 0, 0, 0);
  const end = new Date(to);
  while (cursor <= end) {
    const day = localDateKey(cursor.toISOString());
    byDay.set(day, { changed: 0, failed: 0, label: day, new: 0, successful: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const row of runs) {
    const day = localDateKey(row.bucket);
    const point = byDay.get(day) ?? { changed: 0, failed: 0, label: day, new: 0, successful: 0 };
    if (row.status === "succeeded") {
      point.successful += row.count;
    } else {
      point.failed += row.count;
    }
    byDay.set(day, point);
  }
  for (const row of changes) {
    const day = localDateKey(row.bucket);
    const point = byDay.get(day) ?? { changed: 0, failed: 0, label: day, new: 0, successful: 0 };
    if (row.change_kind === "created") {
      point.new += row.count;
    } else {
      point.changed += row.count;
    }
    byDay.set(day, point);
  }
  return { points: [...byDay.values()].sort((left, right) => left.label.localeCompare(right.label)) };
}

function localDateKey(iso: string): string {
  const parts = localDayFormatter.formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function buildFunctionCatalogue(
  env: Env,
  process: ProcessRow | null,
  lastSync: SyncRow | null,
  lastScheduledSync: SyncRow | null
): unknown[] {
  const matoolReady = Boolean(
    env.MATOOL_EMAIL &&
      env.MATOOL_PASSWORD &&
      env.MATOOL_REAL_RUNS_ENABLED === "confirmed-read-only"
  );
  const outbound = env.OUTBOUND_DELIVERY_ENABLED === "true";
  return [
    {
      key: "scheduled_matool_sync",
      name: "Automatischer MATOOL-Datenabruf",
      description: "Liest alle freigegebenen Bereiche stundenweise und speichert Snapshots in D1.",
      areas: [...MATOOL_SNAPSHOT_AREAS],
      state: matoolReady ? "enabled" : "unavailable",
      execution: "automatic",
      lastRunAt: lastScheduledSync?.started_at ?? null,
      dependencies: ["MATOOL Read-only", "Cloudflare Cron", "Cloudflare D1"]
    },
    {
      key: "manual_matool_sync",
      name: "Manueller MATOOL-Datenabruf",
      description: "Startet denselben read-only Abruf geschuetzt fuer Mitarbeiter.",
      areas: [...MATOOL_SNAPSHOT_AREAS],
      state: matoolReady ? "enabled" : "unavailable",
      execution: "manual",
      lastRunAt: lastSync?.trigger_kind === "manual" ? lastSync.started_at : null,
      dependencies: ["Mitarbeiterzugriff", "CSRF-Schutz", "MATOOL Read-only"]
    },
    {
      key: "class_extraction",
      name: "Vollstaendiger Klassenabruf",
      description: "Liest Klassen ueber den bestaetigten Detail-Endpunkt ohne Schuelerlisten.",
      areas: ["klassen"],
      state: matoolReady ? "enabled" : "unavailable",
      execution: "automatic_and_manual",
      lastRunAt: lastSync?.started_at ?? null,
      dependencies: ["MATOOL Read-only"]
    },
    {
      key: "generic_area_extraction",
      name: "Generischer Bereichsabruf",
      description: "Liest die elf weiteren freigegebenen MATOOL-Bereiche tabellenbasiert und ohne Schreibzugriff.",
      areas: MATOOL_SNAPSHOT_AREAS.filter((area) => area !== "klassen"),
      state: matoolReady ? "enabled" : "unavailable",
      execution: "automatic_and_manual",
      lastRunAt: lastSync?.started_at ?? null,
      dependencies: ["MATOOL Read-only"]
    },
    {
      key: "matool_structure_tools",
      name: "MATOOL-Strukturpruefung",
      description: "Prueft die lesbare Interessentenstruktur und technische Tabellenmerkmale fuer die Fehlersuche.",
      areas: ["interessenten"],
      state: matoolReady ? "enabled" : "unavailable",
      execution: "manual",
      lastRunAt: null,
      dependencies: ["Mitarbeiterzugriff", "CSRF-Schutz", "MATOOL Read-only"]
    },
    {
      key: "health_check",
      name: "Betriebsbereitschaftspruefung",
      description: "Stellt einen minimalen Nur-Lese-Endpunkt fuer die technische Erreichbarkeitspruefung bereit.",
      areas: [],
      state: "enabled",
      execution: "on_demand",
      lastRunAt: null,
      dependencies: ["Cloudflare Worker"]
    },
    {
      key: "dashboard_readonly",
      name: "Maskiertes Hub-Kontrollzentrum",
      description: "Zeigt Status, Verlauf und Datenbank serverseitig maskiert an.",
      areas: [...MATOOL_SNAPSHOT_AREAS],
      state: "enabled",
      execution: "on_demand",
      lastRunAt: null,
      dependencies: ["Cloudflare D1"]
    },
    {
      key: "zapier_snapshot_polling",
      name: "Zapier-Datenabholung",
      description: "Stellt gespeicherte MATOOL-Snapshots fuer die private Zapier-App bereit.",
      areas: [...MATOOL_SNAPSHOT_AREAS],
      state: env.ZAPIER_SERVICE_TOKEN ? "enabled" : "unavailable",
      execution: "on_demand",
      lastRunAt: null,
      dependencies: ["Zapier-Service-Token", "Cloudflare D1"]
    },
    {
      key: "zapier_subscription_management",
      name: "Zapier-Abonnementverwaltung",
      description: "Registriert und beendet autorisierte Zapier-Abonnements ueber den privaten Servicezugriff.",
      areas: [],
      state: outbound && env.ZAPIER_WEBHOOK_SIGNING_SECRET ? "enabled" : "disabled",
      execution: "on_demand",
      lastRunAt: null,
      dependencies: ["Ausgehende Zapier-Zustellung", "Webhook-Signierschluessel"]
    },
    {
      key: "zapier_claim_confirm",
      name: "Zapier Claim und Bestaetigung",
      description: "Reserviert freigegebene Ereignisse einmalig und bestaetigt deren Ergebnis idempotent.",
      areas: ["interessenten"],
      state: outbound && env.ZAPIER_WEBHOOK_SIGNING_SECRET ? "enabled" : "disabled",
      execution: "on_demand",
      lastRunAt: null,
      dependencies: ["Ausgehende Zapier-Zustellung", "Webhook-Signierschluessel", "Cloudflare D1"]
    },
    {
      key: "first_trial_contact",
      name: "Kontakt vor dem ersten Probetraining",
      description: "Vorbereiteter Prozess; Kontakt und Zustellung bleiben in dieser Phase ausgeschaltet.",
      areas: ["interessenten"],
      state: process?.mode === "active" && outbound ? "enabled" : "disabled",
      execution: "automatic",
      lastRunAt: null,
      dependencies: ["Freigegebene Kontaktregel", "Zapier-Zustellung"]
    },
    {
      key: "zapier_outbound",
      name: "Ausgehende Zapier-Zustellung",
      description: "Transportiert freigegebene Ereignisse; aktuell bewusst deaktiviert.",
      areas: [],
      state: outbound ? "enabled" : "disabled",
      execution: "automatic",
      lastRunAt: null,
      dependencies: ["Aktiver Prozessmodus", "Zapier-Abonnement"]
    }
  ];
}

interface DashboardSnapshotRow {
  change_kind: "created" | "updated";
  first_seen_at: string;
  is_current: number;
  last_changed_at: string;
  last_seen_at: string;
  payload_json: string;
  public_id: string;
}

interface DashboardColumnKeyRow {
  field_key: unknown;
}

interface DashboardRecordDetailRow extends DashboardSnapshotRow {
  is_current: number;
  last_run_error_code: string | null;
  last_run_finished_at: string | null;
  last_run_started_at: string | null;
  last_run_status: "failed" | "succeeded" | null;
}

interface DashboardRecordHistoryRow {
  change_kind: "created" | "updated";
  error_code: string | null;
  finished_at: string | null;
  observed_at: string;
  started_at: string | null;
  status: "failed" | "succeeded" | null;
}

interface DashboardActivityRow {
  activity_type: string;
  affected_count: number;
  area: string | null;
  http_status: number | null;
  internal_id: string;
  kind: "automation" | "data" | "sync" | "zapier";
  occurred_at: string;
  public_id: string | null;
  status: "failed" | "info" | "running" | "skipped" | "succeeded" | "warning";
  technical_code: string | null;
}

const DASHBOARD_AREA_SET = new Set<string>(MATOOL_SNAPSHOT_AREAS);
const DASHBOARD_ACTIVITY_KINDS = new Set([
  "automation",
  "data",
  "sync",
  "zapier"
]);
const DASHBOARD_ACTIVITY_STATUSES = new Set([
  "failed",
  "info",
  "running",
  "skipped",
  "succeeded",
  "warning"
]);
const DASHBOARD_RECORD_CHANGES = new Set(["all", "created", "updated"]);
const DASHBOARD_RECORD_DIRECTIONS = new Set(["asc", "desc"]);
const DASHBOARD_RECORD_SORTS = new Set([
  "firstSeenAt",
  "lastChangedAt",
  "lastSeenAt",
  "recordRef"
]);

const DASHBOARD_PRIVACY = {
  masked: true,
  mode: "server-side",
  notice:
    "Personenbezogene Werte und interne MATOOL-Kennungen werden vor der Uebermittlung maskiert."
} as const;

const DASHBOARD_PRIVACY_PLAINTEXT = {
  masked: false,
  mode: "server-side",
  notice:
    "Klartextansicht fuer die Testphase freigegeben. Vor dem ersten Echtdatenlauf PUBLIC_DASHBOARD_PLAINTEXT auf false setzen."
} as const;

/**
 * Klartextanzeige ist ein bewusst gesetzter Umgebungsschalter. Sie ist fuer
 * die Testphase mit MATOOL-Testdaten freigegeben; fuer echte Personendaten
 * muss der Schalter wieder auf "false" stehen.
 */
function isDashboardPlaintext(env: Env): boolean {
  return env.PUBLIC_DASHBOARD_PLAINTEXT === "true";
}

function dashboardPrivacyNotice(
  env: Env
): typeof DASHBOARD_PRIVACY | typeof DASHBOARD_PRIVACY_PLAINTEXT {
  return isDashboardPlaintext(env)
    ? DASHBOARD_PRIVACY_PLAINTEXT
    : DASHBOARD_PRIVACY;
}

const DASHBOARD_ACTIVITY_CTE = `WITH dashboard_activities AS (
  SELECT
    'sync:' || sync_id AS internal_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', started_at) AS occurred_at,
    'automation' AS kind,
    NULL AS area,
    CASE
      WHEN status = 'partial_failed' THEN 'warning'
      ELSE status
    END AS status,
    CASE
      WHEN trigger_kind = 'scheduled' THEN 'scheduled_sync'
      ELSE 'manual_sync'
    END AS activity_type,
    stored_count AS affected_count,
    error_code AS technical_code,
    NULL AS http_status,
    NULL AS public_id
  FROM matool_sync_runs

  UNION ALL

  SELECT
    'area-run:' || run_id AS internal_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', started_at) AS occurred_at,
    'sync' AS kind,
    area,
    status,
    'area_sync' AS activity_type,
    CASE
      WHEN status = 'succeeded' THEN success_count
      ELSE failure_count
    END AS affected_count,
    error_code AS technical_code,
    NULL AS http_status,
    NULL AS public_id
  FROM matool_snapshot_runs

  UNION ALL

  SELECT
    'change:' || changes.change_id AS internal_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', changes.observed_at) AS occurred_at,
    'data' AS kind,
    changes.area,
    'info' AS status,
    CASE
      WHEN changes.change_kind = 'created' THEN 'record_created'
      ELSE 'record_updated'
    END AS activity_type,
    1 AS affected_count,
    NULL AS technical_code,
    NULL AS http_status,
    snapshots.public_id
  FROM matool_snapshot_changes AS changes
  LEFT JOIN matool_snapshots AS snapshots
    ON snapshots.area = changes.area
   AND snapshots.source_id = changes.source_id

  UNION ALL

  SELECT
    'event:' || event_id AS internal_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS occurred_at,
    'zapier' AS kind,
    CASE WHEN collector = ? THEN 'interessenten' ELSE NULL END AS area,
    CASE
      WHEN status IN ('action_confirmed', 'transport_accepted') THEN 'succeeded'
      WHEN status = 'failed' THEN 'failed'
      WHEN status = 'cancelled' THEN 'skipped'
      ELSE 'info'
    END AS status,
    'zapier_event' AS activity_type,
    1 AS affected_count,
    CASE WHEN status = 'failed' THEN 'zapier_event_failed' ELSE NULL END AS technical_code,
    NULL AS http_status,
    NULL AS public_id
  FROM events

  UNION ALL

  SELECT
    'delivery:' || deliveries.delivery_id AS internal_id,
    strftime('%Y-%m-%dT%H:%M:%fZ', deliveries.finished_at) AS occurred_at,
    'zapier' AS kind,
    CASE WHEN events.collector = ? THEN 'interessenten' ELSE NULL END AS area,
    CASE
      WHEN deliveries.outcome = 'accepted' THEN 'succeeded'
      WHEN deliveries.outcome = 'retryable_error' THEN 'warning'
      ELSE 'failed'
    END AS status,
    'zapier_delivery' AS activity_type,
    1 AS affected_count,
    CASE
      WHEN deliveries.outcome = 'accepted' THEN NULL
      ELSE deliveries.outcome
    END AS technical_code,
    deliveries.http_status,
    NULL AS public_id
  FROM deliveries
  LEFT JOIN events ON events.event_id = deliveries.event_id
)`;

export async function listDashboardActivities(
  env: Env,
  query: DashboardActivityQuery
): Promise<unknown> {
  const pagination = requireDashboardPagination(query.page, query.pageSize);
  const area = query.area === undefined
    ? undefined
    : requireDashboardArea(query.area);
  if (query.kind !== undefined && !DASHBOARD_ACTIVITY_KINDS.has(query.kind)) {
    throw invalidDashboardQuery();
  }
  if (
    query.status !== undefined &&
    !DASHBOARD_ACTIVITY_STATUSES.has(query.status)
  ) {
    throw invalidDashboardQuery();
  }
  const from = query.from === undefined
    ? undefined
    : requireDashboardTimestamp(query.from);
  const to = query.to === undefined
    ? undefined
    : requireDashboardTimestamp(query.to);
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw invalidDashboardQuery();
  }

  const conditions = ["occurred_at IS NOT NULL"];
  const filterBindings: Array<number | string> = [];
  if (area) {
    conditions.push("area = ?");
    filterBindings.push(area);
  }
  if (query.kind) {
    conditions.push("kind = ?");
    filterBindings.push(query.kind);
  }
  if (query.status) {
    conditions.push("status = ?");
    filterBindings.push(query.status);
  }
  if (from) {
    conditions.push("occurred_at >= ?");
    filterBindings.push(from);
  }
  if (to) {
    conditions.push("occurred_at <= ?");
    filterBindings.push(to);
  }
  const whereSql = conditions.join(" AND ");
  const commonBindings = [
    FIRST_TRIAL_COLLECTOR,
    FIRST_TRIAL_COLLECTOR,
    ...filterBindings
  ];

  try {
    const [count, rows] = await Promise.all([
      env.DB.prepare(
        `${DASHBOARD_ACTIVITY_CTE}
         SELECT COUNT(*) AS count
         FROM dashboard_activities
         WHERE ${whereSql}`
      )
        .bind(...commonBindings)
        .first<CountRow>(),
      env.DB.prepare(
        `${DASHBOARD_ACTIVITY_CTE}
         SELECT internal_id, occurred_at, kind, area, status, activity_type,
                affected_count, technical_code, http_status, public_id
         FROM dashboard_activities
         WHERE ${whereSql}
         ORDER BY occurred_at DESC, internal_id DESC
         LIMIT ? OFFSET ?`
      )
        .bind(
          ...commonBindings,
          pagination.pageSize,
          pagination.offset
        )
        .all<DashboardActivityRow>()
    ]);

    const total = normalizeCount(count?.count);
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      privacy: dashboardPrivacyNotice(env),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
      activities: rows.results.map((row, index) =>
        mapDashboardActivity(row, pagination.offset + index)
      )
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "dashboard_activity_unavailable",
      503,
      "Der Aktivitaetsverlauf kann momentan nicht geladen werden."
    );
  }
}

export async function listDashboardRecords(
  env: Env,
  query: DashboardRecordQuery
): Promise<unknown> {
  const area = requireDashboardArea(query.area);
  const pagination = requireDashboardPagination(query.page, query.pageSize);
  if (!DASHBOARD_RECORD_CHANGES.has(query.change)) {
    throw invalidDashboardQuery();
  }
  if (!DASHBOARD_RECORD_DIRECTIONS.has(query.direction)) {
    throw invalidDashboardQuery();
  }
  if (!DASHBOARD_RECORD_SORTS.has(query.sort)) {
    throw invalidDashboardQuery();
  }
  const normalizedQuery = requireDashboardSearchQuery(query.query);
  const searchableFields = searchableDashboardFields(area);
  const conditions: string[] = [];
  const filterBindings: string[] = [];
  if (query.change !== "all") {
    conditions.push("record.change_kind = ?");
    filterBindings.push(query.change);
  }
  if (normalizedQuery) {
    const pattern = `%${escapeLikePattern(normalizedQuery.toLowerCase())}%`;
    const searchExpressions = [
      "LOWER(record.public_id) LIKE ? ESCAPE '\\'"
    ];
    filterBindings.push(pattern);
    for (const field of searchableFields) {
      searchExpressions.push(
        `LOWER(COALESCE(CAST(json_extract(
           CASE WHEN json_valid(record.payload_json)
                THEN record.payload_json ELSE '{}' END,
           '$.${field}'
         ) AS TEXT), '')) LIKE ? ESCAPE '\\'`
      );
      filterBindings.push(pattern);
    }
    conditions.push(`(${searchExpressions.join(" OR ")})`);
  }

  const whereSql = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const direction = query.direction === "asc" ? "ASC" : "DESC";
  const sortColumn = {
    firstSeenAt: "record.first_seen_at",
    lastChangedAt: "record.last_changed_at",
    lastSeenAt: "record.last_seen_at",
    recordRef: "record.public_id"
  }[query.sort];
  const recordsCte = `WITH dashboard_records AS (
    SELECT
      snapshots.public_id,
      snapshots.payload_json,
      snapshots.first_seen_at,
      snapshots.last_seen_at,
      COALESCE(snapshots.last_changed_at, snapshots.first_seen_at) AS last_changed_at,
      CASE WHEN snapshots.last_run_id = (
        SELECT current_run.run_id
        FROM matool_snapshot_runs AS current_run
        WHERE current_run.area = snapshots.area
          AND current_run.status = 'succeeded'
        ORDER BY current_run.started_at DESC
        LIMIT 1
      ) THEN 1 ELSE 0 END AS is_current,
      COALESCE((
        SELECT changes.change_kind
        FROM matool_snapshot_changes AS changes
        WHERE changes.area = snapshots.area
          AND changes.source_id = snapshots.source_id
        ORDER BY changes.observed_at DESC, changes.change_id DESC
        LIMIT 1
      ), 'created') AS change_kind
    FROM matool_snapshots AS snapshots
    WHERE snapshots.area = ?
      AND snapshots.public_id IS NOT NULL
  )`;

  try {
    const [count, rows, storedColumns] = await Promise.all([
      env.DB.prepare(
        `${recordsCte}
         SELECT COUNT(*) AS count
         FROM dashboard_records AS record
         ${whereSql}`
      )
        .bind(area, ...filterBindings)
        .first<CountRow>(),
      env.DB.prepare(
        `${recordsCte}
         SELECT public_id, payload_json, first_seen_at, last_seen_at,
                last_changed_at, is_current, change_kind
         FROM dashboard_records AS record
         ${whereSql}
         ORDER BY ${sortColumn} ${direction}, record.public_id ${direction}
         LIMIT ? OFFSET ?`
      )
        .bind(
          area,
          ...filterBindings,
          pagination.pageSize,
          pagination.offset
        )
        .all<DashboardSnapshotRow>(),
      env.DB.prepare(
        `SELECT DISTINCT fields.key AS field_key
         FROM matool_snapshots AS snapshots,
              json_each(
                CASE WHEN json_valid(snapshots.payload_json)
                     THEN snapshots.payload_json ELSE '{}' END
              ) AS fields
         WHERE snapshots.area = ?
         ORDER BY field_key`
      )
        .bind(area)
        .all<DashboardColumnKeyRow>()
    ]);

    const schemaPayload = Object.fromEntries(
      storedColumns.results
        .map((row) => row.field_key)
        .filter(
          (key): key is string =>
            typeof key === "string" &&
            /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)
        )
        .map((key) => [key, null])
    );
    const plaintext = isDashboardPlaintext(env);
    const columns = dashboardColumns(area, [schemaPayload], plaintext);
    const total = normalizeCount(count?.count);
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      privacy: dashboardPrivacyNotice(env),
      area,
      label: areaLabel(area),
      masked: !plaintext,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
      columns,
      records: rows.results.map((row) => ({
        publicId: row.public_id,
        recordRef: dashboardRecordRef(row.public_id),
        change: row.change_kind,
        isCurrent: row.is_current === 1,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        lastChangedAt: row.last_changed_at,
        values: dashboardValues(
          area,
          parseStoredPayload(row.payload_json),
          columns,
          plaintext
        )
      }))
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "dashboard_records_unavailable",
      503,
      "Die maskierte Datenbankansicht kann momentan nicht geladen werden."
    );
  }
}

export async function getDashboardRecord(
  env: Env,
  areaInput: string,
  publicIdInput: string
): Promise<unknown> {
  const area = requireDashboardArea(areaInput);
  const publicId = requireDashboardPublicId(publicIdInput);

  try {
    const [record, history] = await Promise.all([
      env.DB.prepare(
        `SELECT
           snapshots.public_id,
           snapshots.payload_json,
           snapshots.first_seen_at,
           snapshots.last_seen_at,
           COALESCE(snapshots.last_changed_at, snapshots.first_seen_at) AS last_changed_at,
           COALESCE((
             SELECT changes.change_kind
             FROM matool_snapshot_changes AS changes
             WHERE changes.area = snapshots.area
               AND changes.source_id = snapshots.source_id
             ORDER BY changes.observed_at DESC, changes.change_id DESC
             LIMIT 1
           ), 'created') AS change_kind,
           CASE WHEN snapshots.last_run_id = (
             SELECT runs.run_id
             FROM matool_snapshot_runs AS runs
             WHERE runs.area = snapshots.area
               AND runs.status = 'succeeded'
             ORDER BY runs.started_at DESC
             LIMIT 1
           ) THEN 1 ELSE 0 END AS is_current,
           last_run.status AS last_run_status,
           last_run.started_at AS last_run_started_at,
           last_run.finished_at AS last_run_finished_at,
           last_run.error_code AS last_run_error_code
         FROM matool_snapshots AS snapshots
         LEFT JOIN matool_snapshot_runs AS last_run
           ON last_run.run_id = snapshots.last_run_id
         WHERE snapshots.area = ?
           AND snapshots.public_id = ?
         LIMIT 1`
      )
        .bind(area, publicId)
        .first<DashboardRecordDetailRow>(),
      env.DB.prepare(
        `SELECT changes.change_kind, changes.observed_at,
                runs.status, runs.started_at, runs.finished_at, runs.error_code
         FROM matool_snapshot_changes AS changes
         INNER JOIN matool_snapshots AS snapshots
           ON snapshots.area = changes.area
          AND snapshots.source_id = changes.source_id
         LEFT JOIN matool_snapshot_runs AS runs
           ON runs.run_id = changes.run_id
         WHERE snapshots.area = ?
           AND snapshots.public_id = ?
         ORDER BY changes.observed_at DESC, changes.change_id DESC
         LIMIT 101`
      )
        .bind(area, publicId)
        .all<DashboardRecordHistoryRow>()
    ]);

    if (!record) {
      throw new AppError(
        "dashboard_record_not_found",
        404,
        "Der angeforderte Datensatz wurde nicht gefunden."
      );
    }

    const historyTruncated = history.results.length > 100;
    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      privacy: dashboardPrivacyNotice(env),
      area,
      label: areaLabel(area),
      masked: true,
      publicId: record.public_id,
      recordRef: dashboardRecordRef(record.public_id),
      technicalIdentifier: PROTECTED_DASHBOARD_VALUE,
      firstSeenAt: record.first_seen_at,
      lastSeenAt: record.last_seen_at,
      lastChangedAt: record.last_changed_at,
      change: record.change_kind,
      isCurrent: record.is_current === 1,
      status: {
        current: record.is_current === 1,
        lastRunStatus: record.last_run_status,
        lastRunStartedAt: record.last_run_started_at,
        lastRunFinishedAt: record.last_run_finished_at,
        lastRunErrorCode: safeTechnicalCode(record.last_run_error_code)
      },
      fields: dashboardFieldValues(
        area,
        parseStoredPayload(record.payload_json),
        isDashboardPlaintext(env)
      ),
      changeHistory: history.results.slice(0, 100).map((entry) => ({
        change: entry.change_kind,
        occurredAt: entry.observed_at,
        status: entry.status ?? "succeeded",
        runStartedAt: entry.started_at,
        runFinishedAt: entry.finished_at,
        errorCode: safeTechnicalCode(entry.error_code),
        description:
          entry.change_kind === "created"
            ? "Datensatz wurde erstmals gespeichert."
            : "Gespeicherter Datensatz wurde aktualisiert."
      })),
      historyTruncated
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "dashboard_record_unavailable",
      503,
      "Die maskierte Datensatzansicht kann momentan nicht geladen werden."
    );
  }
}

function mapDashboardActivity(
  row: DashboardActivityRow,
  absoluteIndex: number
): unknown {
  const label = row.area ? areaLabel(row.area) : null;
  const presentation = dashboardActivityPresentation(row.activity_type, label);
  const publicId = isDashboardPublicId(row.public_id) ? row.public_id : null;
  return {
    id: `activity-${absoluteIndex + 1}`,
    occurredAt: row.occurred_at,
    kind: row.kind,
    type: row.activity_type,
    status: row.status,
    area: row.area,
    areaLabel: label,
    title: presentation.title,
    description: presentation.description,
    affectedCount: normalizeCount(row.affected_count),
    publicId,
    recordRef: publicId ? dashboardRecordRef(publicId) : null,
    technicalCode: safeTechnicalCode(row.technical_code),
    technicalDetails:
      safeHttpStatus(row.http_status) === null
        ? null
        : { httpStatus: safeHttpStatus(row.http_status) },
    technical: {
      code: safeTechnicalCode(row.technical_code),
      httpStatus: safeHttpStatus(row.http_status)
    }
  };
}

function dashboardActivityPresentation(
  type: string,
  label: string | null
): { description: string; title: string } {
  switch (type) {
    case "scheduled_sync":
      return {
        title: "Automatischer Gesamtabruf",
        description: "Der geplante read-only MATOOL-Abruf wurde ausgefuehrt."
      };
    case "manual_sync":
      return {
        title: "Manueller Gesamtabruf",
        description: "Ein geschuetzter manueller read-only MATOOL-Abruf wurde ausgefuehrt."
      };
    case "area_sync":
      return {
        title: `${label ?? "MATOOL-Bereich"} abgerufen`,
        description: "Der Datenbereich wurde read-only gelesen und in D1 verarbeitet."
      };
    case "record_created":
      return {
        title: "Datensatz neu gespeichert",
        description: `${label ?? "Ein Datenbereich"} enthaelt einen neuen gespeicherten Datensatz.`
      };
    case "record_updated":
      return {
        title: "Datensatz aktualisiert",
        description: `${label ?? "Ein Datenbereich"} enthaelt einen geaenderten gespeicherten Datensatz.`
      };
    case "zapier_event":
      return {
        title: "Zapier-Ereignisstatus",
        description: "Ein internes Zapier-Ereignis hat seinen Betriebsstatus gemeldet."
      };
    case "zapier_delivery":
      return {
        title: "Zapier-Zustellversuch",
        description: "Ein Zustellversuch wurde ohne Ausgabe von Zieladresse oder Personendaten protokolliert."
      };
    default:
      return {
        title: "Hub-Aktivitaet",
        description: "Eine interne Hintergrundaktivitaet wurde protokolliert."
      };
  }
}

function requireDashboardArea(value: string): string {
  if (!DASHBOARD_AREA_SET.has(value)) {
    throw new AppError(
      "unknown_matool_area",
      400,
      "Dieser MATOOL-Bereich ist nicht freigegeben."
    );
  }
  return value;
}

function requireDashboardPagination(
  page: number,
  pageSize: number
): { offset: number; page: number; pageSize: number } {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100_000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw invalidDashboardQuery();
  }
  return { offset: (page - 1) * pageSize, page, pageSize };
}

function requireDashboardTimestamp(value: string): string {
  if (value.length === 0 || value.length > 40) {
    throw invalidDashboardQuery();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw invalidDashboardQuery();
  }
  return new Date(timestamp).toISOString();
}

function requireDashboardSearchQuery(value: string): string {
  if (typeof value !== "string") {
    throw invalidDashboardQuery();
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length > 100) {
    throw invalidDashboardQuery();
  }
  return normalized;
}

function requireDashboardPublicId(value: string): string {
  if (!/^[a-f0-9]{32}$/u.test(value)) {
    throw invalidDashboardQuery();
  }
  return value;
}

function isDashboardPublicId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
}

function dashboardRecordRef(publicId: string): string {
  return `REC-${publicId.slice(0, 8).toUpperCase()}`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function safeTechnicalCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,96}$/u.test(value)
    ? value
    : null;
}

function safeHttpStatus(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

function invalidDashboardQuery(): AppError {
  return new AppError(
    "invalid_dashboard_query",
    400,
    "Die Dashboard-Abfrage enthaelt ungueltige Filterwerte."
  );
}
