import { AppError } from "../core/app-error";
import {
  FIRST_TRIAL_COLLECTOR,
  FIRST_TRIAL_EVENT_TYPE
} from "../core/first-trial";
import type { Env } from "./env";

interface ProcessRow {
  process_key: string;
  display_name: string;
  mode: "disabled" | "dry_run" | "shadow" | "active";
  policy_version: number;
  config_json: string;
  updated_at: string;
}

interface RunRow {
  run_id: string;
  mode: "dry_run" | "shadow" | "active";
  trigger_kind: "manual" | "scheduled" | "test";
  status: "running" | "succeeded" | "failed" | "skipped";
  started_at: string;
  finished_at: string | null;
  fetched_count: number;
  candidate_count: number;
  event_count: number;
  error_code: string | null;
}

interface CountRow {
  count: number;
  status: string;
}

interface TotalCountRow {
  count: number;
}

interface MatoolSnapshotRunRow {
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

interface MatoolSnapshotAreaCountRow {
  area: string;
  count: number;
}

interface FirstTrialConfig {
  contactChannel: "email" | "sms" | "staff_task" | null;
  contactLeadMinutes: number | null;
  lookbackMinutes: number | null;
}

export async function getAdminStatus(env: Env): Promise<unknown> {
  try {
    const [
      process,
      lastRun,
      eventCounts,
      activeSubscriptions,
      unconfirmedClaims,
      lastMatoolSnapshotRun,
      matoolSnapshotCounts
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT process_key, display_name, mode, policy_version, config_json, updated_at
         FROM process_config
         WHERE process_key = ?`
      )
        .bind(FIRST_TRIAL_COLLECTOR)
        .first<ProcessRow>(),
      env.DB.prepare(
        `SELECT run_id, mode, trigger_kind, status, started_at, finished_at,
                fetched_count, candidate_count, event_count, error_code
         FROM runs
         WHERE collector = ?
         ORDER BY started_at DESC
         LIMIT 1`
      )
        .bind(FIRST_TRIAL_COLLECTOR)
        .first<RunRow>(),
      env.DB.prepare(
        `SELECT status, COUNT(*) AS count
         FROM events
         WHERE collector = ?
         GROUP BY status`
      )
        .bind(FIRST_TRIAL_COLLECTOR)
        .all<CountRow>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM zapier_subscriptions
         WHERE status = 'active'
           AND event_type = ?`
      )
        .bind(FIRST_TRIAL_EVENT_TYPE)
        .first<TotalCountRow>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM event_claims
         WHERE confirmed_at IS NULL
           AND datetime(review_after) <= CURRENT_TIMESTAMP`
      ).first<TotalCountRow>(),
      env.DB.prepare(
        `SELECT run_id, area, status, started_at, finished_at,
                fetched_count, success_count, failure_count, error_code
         FROM matool_snapshot_runs
         ORDER BY started_at DESC
         LIMIT 1`
      ).first<MatoolSnapshotRunRow>(),
      env.DB.prepare(
        `SELECT area, COUNT(*) AS count
         FROM matool_snapshots
         GROUP BY area
         ORDER BY area`
      ).all<MatoolSnapshotAreaCountRow>()
    ]);

    if (!process) {
      throw new AppError(
        "database_not_initialized",
        503,
        "Die lokale Datenbankmigration wurde noch nicht angewendet."
      );
    }

    const config = parseFirstTrialConfig(process.config_json);
    const policyComplete =
      Number.isInteger(config.contactLeadMinutes) &&
      Number.isInteger(config.lookbackMinutes) &&
      config.contactChannel !== null;

    return {
      schemaVersion: 1,
      environment: env.APP_ENV,
      process: {
        key: process.process_key,
        name: process.display_name,
        mode: process.mode,
        policyVersion: process.policy_version,
        policyComplete,
        policy: {
          contactChannel: config.contactChannel,
          contactLeadMinutes: config.contactLeadMinutes,
          lookbackMinutes: config.lookbackMinutes
        },
        updatedAt: process.updated_at
      },
      connections: {
        matool: {
          configured: Boolean(env.MATOOL_EMAIL && env.MATOOL_PASSWORD),
          realRunsEnabled:
            env.MATOOL_REAL_RUNS_ENABLED === "confirmed-read-only",
          sourceMappingVerified: false
        },
        zapier: {
          activeSubscriptions: activeSubscriptions?.count ?? 0,
          claimGuardImplemented: true,
          configured: Boolean(
            env.ZAPIER_SERVICE_TOKEN &&
              env.ZAPIER_WEBHOOK_SIGNING_SECRET &&
              (activeSubscriptions?.count ?? 0) === 1
          ),
          outboundEnabled: env.OUTBOUND_DELIVERY_ENABLED === "true",
          plan: "Professional",
          targetDedupeVerified: false,
          unconfirmedClaims: unconfirmedClaims?.count ?? 0
        }
      },
      lastRun: lastRun ? mapRun(lastRun) : null,
      matoolSnapshots: {
        areas: Object.fromEntries(
          matoolSnapshotCounts.results.map((row) => [
            row.area,
            row.count
          ])
        ),
        lastRun: lastMatoolSnapshotRun
          ? {
              area: lastMatoolSnapshotRun.area,
              errorCode: lastMatoolSnapshotRun.error_code,
              failureCount: lastMatoolSnapshotRun.failure_count,
              fetchedCount: lastMatoolSnapshotRun.fetched_count,
              finishedAt: lastMatoolSnapshotRun.finished_at,
              id: lastMatoolSnapshotRun.run_id,
              startedAt: lastMatoolSnapshotRun.started_at,
              status: lastMatoolSnapshotRun.status,
              successCount: lastMatoolSnapshotRun.success_count
            }
          : null
      },
      eventCounts: Object.fromEntries(
        eventCounts.results.map((row) => [row.status, row.count])
      ),
      safetyGates: [
        {
          key: "matool_password_rotated",
          state:
            env.MATOOL_REAL_RUNS_ENABLED === "confirmed-read-only"
              ? "ready"
              : "requires_confirmation"
        },
        {
          key: "first_trial_source_mapping",
          state: "open"
        },
        {
          key: "contact_policy",
          state: policyComplete ? "ready" : "open"
        },
        {
          key: "zapier_target_dedupe",
          state: "open"
        }
      ]
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "database_unavailable",
      503,
      "Der Middleware-Status ist momentan nicht verfügbar."
    );
  }
}

export async function listRuns(
  env: Env,
  limit: number
): Promise<unknown> {
  try {
    const result = await env.DB.prepare(
      `SELECT run_id, mode, trigger_kind, status, started_at, finished_at,
              fetched_count, candidate_count, event_count, error_code
       FROM runs
       WHERE collector = ?
       ORDER BY started_at DESC
       LIMIT ?`
    )
      .bind(FIRST_TRIAL_COLLECTOR, limit)
      .all<RunRow>();

    return {
      schemaVersion: 1,
      runs: result.results.map(mapRun)
    };
  } catch {
    throw new AppError(
      "database_unavailable",
      503,
      "Die Laufhistorie ist momentan nicht verfügbar."
    );
  }
}

export async function getProcessMode(
  env: Env
): Promise<ProcessRow["mode"]> {
  const process = await env.DB.prepare(
    "SELECT mode FROM process_config WHERE process_key = ?"
  )
    .bind(FIRST_TRIAL_COLLECTOR)
    .first<Pick<ProcessRow, "mode">>();

  return process?.mode ?? "disabled";
}

function mapRun(row: RunRow): unknown {
  return {
    id: row.run_id,
    mode: row.mode,
    trigger: row.trigger_kind,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    fetchedCount: row.fetched_count,
    candidateCount: row.candidate_count,
    eventCount: row.event_count,
    errorCode: row.error_code
  };
}

function parseFirstTrialConfig(value: string): FirstTrialConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError(
      "invalid_process_config",
      500,
      "Die Prozesskonfiguration ist ungültig."
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "invalid_process_config",
      500,
      "Die Prozesskonfiguration ist ungültig."
    );
  }

  const config = parsed as Partial<FirstTrialConfig>;
  return {
    contactChannel:
      config.contactChannel === "email" ||
      config.contactChannel === "sms" ||
      config.contactChannel === "staff_task"
        ? config.contactChannel
        : null,
    contactLeadMinutes:
      typeof config.contactLeadMinutes === "number"
        ? config.contactLeadMinutes
        : null,
    lookbackMinutes:
      typeof config.lookbackMinutes === "number"
        ? config.lookbackMinutes
        : null
  };
}
