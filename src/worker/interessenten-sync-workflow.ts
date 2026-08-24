import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { AppError, toAppError } from "../core/app-error";
import { canonicalJson, sha256Hex } from "../core/crypto";
import {
  MatoolClient,
  type MatoolSafeAreaRecord
} from "../matool/client";
import type {
  Env,
  InteressentenSyncWorkflowParams
} from "./env";
import { persistMatoolSnapshotRun } from "./matool-store";
import {
  addInteressentenSyncJobProgress,
  ensureInteressentenSyncSchema,
  failInteressentenSyncJob,
  finalizeInteressentenSyncJob,
  getCurrentInteressentenSyncJob,
  getInteressentenSyncParity,
  selectInteressentenSyncDetailSourceIds,
  startOrRestartInteressentenSyncJob
} from "./interessenten-sync-store";

const DETAIL_BATCH_SIZE = 100;
const MAX_DETAIL_BATCHES = 200;
const MAX_LIST_CYCLES = 10;
const MATOOL_REQUEST_INTERVAL_MS = 700;
const MATOOL_STEP_CONFIG = {
  retries: {
    backoff: "exponential",
    delay: "5 seconds",
    limit: 5
  },
  timeout: "15 minutes"
} as const;

interface StoredCountRow {
  total_count: number;
  unique_count: number;
}

interface ExistingSnapshotRunRow {
  created_count: number;
  fetched_count: number;
  status: string;
  updated_count: number;
}

interface BatchResult {
  created: number;
  processed: number;
  runId: string;
  updated: number;
}

interface ListCycleState {
  jobId: string;
  listCount: number;
  listDigest: string;
}

interface FinalCycleResult {
  complete: boolean;
  detailCount: number;
  extraDetails: number;
  listCount: number;
  missingDetails: number;
  restart: boolean;
}

export interface InteressentenSyncPublicStatus {
  completedDetails: number;
  created: number;
  detailCount: number;
  errors: number;
  extraDetails: number;
  listCount: number;
  missingDetails: number;
  staleDetails: number;
  status: "idle" | "running" | "succeeded" | "failed";
  updated: number;
}

export class InteressentenSyncWorkflow extends WorkflowEntrypoint<
  Env,
  InteressentenSyncWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<InteressentenSyncWorkflowParams>>,
    step: WorkflowStep
  ): Promise<FinalCycleResult> {
    assertWorkflowInstanceId(event.instanceId);
    let activeJobId: string | undefined;

    try {
      for (let cycle = 0; cycle < MAX_LIST_CYCLES; cycle += 1) {
        const jobId = `${event.instanceId}_c${cycle}`;
        activeJobId = jobId;
        const list = await step.do(
          `cycle-${cycle}-list`,
          MATOOL_STEP_CONFIG,
          async () => this.scanAndStartCycle(jobId)
        );

        for (
          let batchIndex = 0;
          batchIndex < MAX_DETAIL_BATCHES;
          batchIndex += 1
        ) {
          const sourceIds = await step.do(
            `cycle-${cycle}-select-${batchIndex}`,
            { ...MATOOL_STEP_CONFIG, sensitive: "output" },
            async () =>
              selectInteressentenSyncDetailSourceIds(
                this.env.DB,
                jobId,
                DETAIL_BATCH_SIZE
              )
          );
          if (sourceIds.length === 0) {
            break;
          }

          const runId = `${jobId}_detail_${batchIndex}`;
          const batch = await step.do(
            `cycle-${cycle}-persist-${batchIndex}`,
            MATOOL_STEP_CONFIG,
            async () => this.persistDetailBatch(runId, sourceIds)
          );
          await step.do(
            `cycle-${cycle}-progress-${batchIndex}`,
            MATOOL_STEP_CONFIG,
            async () => {
              await addInteressentenSyncJobProgress(this.env.DB, jobId, {
                batchKey: batch.runId,
                completedDetails: batch.processed,
                created: batch.created,
                updated: batch.updated,
                updatedAt: new Date().toISOString()
              });
              return { recorded: batch.processed };
            }
          );

          if (batchIndex === MAX_DETAIL_BATCHES - 1) {
            throw new AppError(
              "matool_interessenten_batch_limit",
              503,
              "Der Interessentenabgleich hat seine sichere Batch-Grenze erreicht."
            );
          }
        }

        const finalResult = await step.do(
          `cycle-${cycle}-final-list`,
          MATOOL_STEP_CONFIG,
          async () =>
            this.finishOrRestartCycle(event.instanceId, cycle, list)
        );
        if (!finalResult.restart) {
          return finalResult;
        }
      }

      throw new AppError(
        "matool_interessenten_list_unstable",
        503,
        "Die MATOOL-Interessentenliste hat sich waehrend zu vieler Abgleichzyklen geaendert."
      );
    } catch (error) {
      const errorCode = toAppError(error).code;
      await step.do("record-terminal-error", async () => {
        const job = await getCurrentInteressentenSyncJob(this.env.DB);
        if (
          job?.status === "running" &&
          job.jobId === activeJobId
        ) {
          const now = new Date().toISOString();
          await failInteressentenSyncJob(this.env.DB, job.jobId, {
            errorCode,
            finishedAt: now
          });
        }
        return { failed: true };
      });
      throw new NonRetryableError(errorCode);
    }
  }

  private async scanAndStartCycle(jobId: string): Promise<ListCycleState> {
    await ensureInteressentenSyncSchema(this.env.DB);
    const current = await getCurrentInteressentenSyncJob(this.env.DB);
    if (current?.status === "running" && current.jobId === jobId) {
      return {
        jobId,
        listCount: current.listCount,
        listDigest: current.listDigest
      };
    }

    const baseline = await getStoredInteressentenCount(this.env.DB);
    const extraction = await extractFullInteressentenList(this.env);
    const sourceIds = validateExactSourceIds(extraction.records);
    const listDigest = await snapshotDigest(extraction.records);
    const startedAt = new Date().toISOString();
    const listRunId = `${jobId}_list`;
    const result = await persistMatoolSnapshotRun(this.env.DB, {
      allowedPayloadFields: snapshotPayloadFields(extraction.records),
      area: "interessenten",
      finishedAt: new Date().toISOString(),
      observedAt: startedAt,
      records: extraction.records,
      replaceCurrentSet: true,
      runId: listRunId,
      startedAt
    });
    await startOrRestartInteressentenSyncJob(this.env.DB, {
      initialListCount: baseline.total_count,
      initialListUniqueCount: baseline.unique_count,
      jobId,
      listCount: sourceIds.length,
      listCreatedCount: result.createdCount,
      listDigest,
      listRunId,
      listUpdatedCount: result.updatedCount,
      staleListRemovedCount: result.staleRemovedCount,
      startedAt
    });
    return { jobId, listCount: sourceIds.length, listDigest };
  }

  private async persistDetailBatch(
    runId: string,
    sourceIds: readonly string[]
  ): Promise<BatchResult> {
    const existing = await getExistingSnapshotRun(this.env.DB, runId);
    if (existing) {
      if (
        existing.status !== "succeeded" ||
        existing.fetched_count !== sourceIds.length
      ) {
        throw new AppError(
          "matool_interessenten_batch_conflict",
          503,
          "Ein vorhandener Detailbatch stimmt nicht mit dem fortzusetzenden Lauf ueberein."
        );
      }
      return {
        created: existing.created_count,
        processed: existing.fetched_count,
        runId,
        updated: existing.updated_count
      };
    }

    const extraction = await extractInteressentenDetails(
      this.env,
      sourceIds
    );
    validateReturnedDetailIds(sourceIds, extraction.records);
    const startedAt = new Date().toISOString();
    const result = await persistMatoolSnapshotRun(this.env.DB, {
      allowedPayloadFields: snapshotPayloadFields(extraction.records),
      area: "interessenten_details",
      finishedAt: new Date().toISOString(),
      observedAt: startedAt,
      records: extraction.records,
      runId,
      startedAt
    });
    return {
      created: result.createdCount,
      processed: result.storedCount,
      runId,
      updated: result.updatedCount
    };
  }

  private async finishOrRestartCycle(
    workflowInstanceId: string,
    cycle: number,
    original: ListCycleState
  ): Promise<FinalCycleResult> {
    const extraction = await extractFullInteressentenList(this.env);
    const sourceIds = validateExactSourceIds(extraction.records);
    const listDigest = await snapshotDigest(extraction.records);
    const observedAt = new Date().toISOString();

    if (listDigest !== original.listDigest) {
      const finalRunId = `${original.jobId}_final`;
      const persisted = await persistMatoolSnapshotRun(this.env.DB, {
        allowedPayloadFields: snapshotPayloadFields(extraction.records),
        area: "interessenten",
        finishedAt: new Date().toISOString(),
        observedAt,
        records: extraction.records,
        replaceCurrentSet: true,
        runId: finalRunId,
        startedAt: observedAt
      });
      const nextJobId = `${workflowInstanceId}_c${cycle + 1}`;
      const current = await getCurrentInteressentenSyncJob(this.env.DB);
      if (current?.jobId === nextJobId && current.status === "running") {
        return {
          complete: false,
          detailCount: 0,
          extraDetails: 0,
          listCount: current.listCount,
          missingDetails: current.listCount,
          restart: true
        };
      }
      const now = new Date().toISOString();
      if (current?.jobId === original.jobId && current.status === "running") {
        await failInteressentenSyncJob(this.env.DB, original.jobId, {
          errorCode: "matool_interessenten_list_changed",
          finishedAt: now
        });
      } else if (
        current?.jobId !== original.jobId ||
        current.status !== "failed"
      ) {
        throw new AppError(
          "interessenten_sync_job_conflict",
          409,
          "Der Interessenten-Abgleich ist nicht der aktive fortsetzbare Job."
        );
      }
      await startOrRestartInteressentenSyncJob(this.env.DB, {
        initialListCount: original.listCount,
        initialListUniqueCount: original.listCount,
        jobId: nextJobId,
        listCount: sourceIds.length,
        listCreatedCount: persisted.createdCount,
        listDigest,
        listRunId: finalRunId,
        listUpdatedCount: persisted.updatedCount,
        staleListRemovedCount: persisted.staleRemovedCount,
        startedAt: now
      });
      return {
        complete: false,
        detailCount: 0,
        extraDetails: 0,
        listCount: sourceIds.length,
        missingDetails: sourceIds.length,
        restart: true
      };
    }

    const finalized = await finalizeInteressentenSyncJob(
      this.env.DB,
      original.jobId,
      new Date().toISOString()
    );
    if (!finalized.completed) {
      throw new AppError(
        "matool_interessenten_parity_failed",
        503,
        "Die eindeutigen Interessenten-IDs sind noch nicht deckungsgleich."
      );
    }
    return {
      complete: true,
      detailCount: finalized.parity.detailUnique,
      extraDetails: finalized.parity.extraDetails,
      listCount: finalized.parity.listUnique,
      missingDetails: finalized.parity.missingDetails,
      restart: false
    };
  }
}

export async function startOrResumeInteressentenSyncWorkflow(
  env: Env,
  requestedAt: number,
  trigger: InteressentenSyncWorkflowParams["trigger"]
): Promise<InteressentenSyncPublicStatus> {
  await ensureInteressentenSyncSchema(env.DB);
  const current = await getCurrentInteressentenSyncJob(env.DB);
  const instanceId =
    current?.status === "running"
      ? workflowInstanceIdFromJobId(current.jobId)
      : workflowInstanceIdForTime(requestedAt);
  let instance: WorkflowInstance;
  let instanceStatus: Awaited<ReturnType<WorkflowInstance["status"]>>;
  try {
    instance = await env.INTERESSENTEN_SYNC_WORKFLOW.get(instanceId);
    instanceStatus = await instance.status();
  } catch {
    try {
      instance = await env.INTERESSENTEN_SYNC_WORKFLOW.create({
        id: instanceId,
        params: {
          requestedAt: new Date(requestedAt).toISOString(),
          trigger
        }
      });
      instanceStatus = await instance.status();
    } catch {
      instance = await env.INTERESSENTEN_SYNC_WORKFLOW.get(instanceId);
      instanceStatus = await instance.status();
    }
  }

  if (instanceStatus.status === "unknown") {
    try {
      instance = await env.INTERESSENTEN_SYNC_WORKFLOW.create({
        id: instanceId,
        params: {
          requestedAt: new Date(requestedAt).toISOString(),
          trigger
        }
      });
      instanceStatus = await instance.status();
    } catch {
      instance = await env.INTERESSENTEN_SYNC_WORKFLOW.get(instanceId);
      instanceStatus = await instance.status();
    }
  } else if (instanceStatus.status === "paused") {
    await instance.resume();
  } else if (
    instanceStatus.status === "complete" ||
    instanceStatus.status === "errored" ||
    instanceStatus.status === "terminated"
  ) {
    await instance.restart();
  }

  return getInteressentenSyncPublicStatus(env);
}

export async function getInteressentenSyncPublicStatus(
  env: Env
): Promise<InteressentenSyncPublicStatus> {
  await ensureInteressentenSyncSchema(env.DB);
  const job = await getCurrentInteressentenSyncJob(env.DB);
  if (!job) {
    return emptyPublicStatus();
  }
  const parity = await getInteressentenSyncParity(env.DB, job.jobId);
  return {
    completedDetails: job.completedDetailCount,
    created: job.createdCount,
    detailCount: parity.detailUnique,
    errors: job.errorCount,
    extraDetails: parity.extraDetails,
    listCount: parity.listUnique,
    missingDetails: parity.missingDetails,
    staleDetails: parity.staleDetails,
    status: job.status,
    updated: job.updatedCount
  };
}

function emptyPublicStatus(): InteressentenSyncPublicStatus {
  return {
    completedDetails: 0,
    created: 0,
    detailCount: 0,
    errors: 0,
    extraDetails: 0,
    listCount: 0,
    missingDetails: 0,
    staleDetails: 0,
    status: "idle",
    updated: 0
  };
}

async function extractFullInteressentenList(env: Env) {
  const client = new MatoolClient(env.MATOOL_BASE_URL, undefined, {
    maxRequestCount: 300,
    minRequestIntervalMs: MATOOL_REQUEST_INTERVAL_MS
  });
  try {
    return await client.extractSafeArea(requireCredentials(env), "interessenten");
  } finally {
    client.clearSession();
  }
}

async function extractInteressentenDetails(
  env: Env,
  sourceIds: readonly string[]
) {
  const client = new MatoolClient(env.MATOOL_BASE_URL, undefined, {
    maxRequestCount: DETAIL_BATCH_SIZE + 10,
    minRequestIntervalMs: MATOOL_REQUEST_INTERVAL_MS
  });
  try {
    return await client.extractInteressentenDetails(
      requireCredentials(env),
      sourceIds.length,
      sourceIds
    );
  } finally {
    client.clearSession();
  }
}

function requireCredentials(env: Env): { email: string; password: string } {
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
      "Read-only-Echtdatenlaeufe sind noch nicht freigegeben."
    );
  }
  return { email: env.MATOOL_EMAIL, password: env.MATOOL_PASSWORD };
}

function validateExactSourceIds(
  records: readonly MatoolSafeAreaRecord[]
): string[] {
  if (records.length === 0) {
    throw new AppError(
      "matool_interessenten_empty",
      503,
      "MATOOL hat keine Interessenten geliefert."
    );
  }
  const ids = records.map((record) => record.sourceId);
  if (
    ids.some((sourceId) => !/^\d{1,32}$/u.test(sourceId)) ||
    new Set(ids).size !== ids.length
  ) {
    throw new AppError(
      "matool_interessenten_ids_invalid",
      503,
      "Die MATOOL-Interessentenliste enthaelt ungueltige oder doppelte IDs."
    );
  }
  return ids.sort(compareNumericSourceIds);
}

function validateReturnedDetailIds(
  requested: readonly string[],
  records: readonly MatoolSafeAreaRecord[]
): void {
  const expected = [...requested].sort(compareNumericSourceIds);
  const actual = validateExactSourceIds(records);
  if (
    expected.length !== actual.length ||
    expected.some((sourceId, index) => sourceId !== actual[index])
  ) {
    throw new AppError(
      "matool_interessenten_detail_ids_mismatch",
      503,
      "Ein MATOOL-Detailbatch ist unvollstaendig oder falsch zugeordnet."
    );
  }
}

function compareNumericSourceIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

async function snapshotDigest(
  records: readonly MatoolSafeAreaRecord[]
): Promise<string> {
  const canonicalRecords = records
    .map((record) => ({
      payload: record.payload,
      sourceId: record.sourceId
    }))
    .sort((left, right) =>
      compareNumericSourceIds(left.sourceId, right.sourceId)
    );
  return sha256Hex(canonicalJson(canonicalRecords));
}

function snapshotPayloadFields(
  records: readonly MatoolSafeAreaRecord[]
): string[] {
  const fields = new Set<string>();
  for (const record of records) {
    for (const field of Object.keys(record.payload)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field)) {
        throw new AppError(
          "matool_interessenten_field_invalid",
          503,
          "MATOOL hat einen nicht freigegebenen Feldnamen geliefert."
        );
      }
      fields.add(field);
    }
  }
  if (fields.size === 0 || fields.size > 80) {
    throw new AppError(
      "matool_interessenten_field_limit",
      503,
      "Die Interessentenfelder sind leer oder ueberschreiten das sichere Schema."
    );
  }
  return [...fields].sort((left, right) => left.localeCompare(right));
}

async function getStoredInteressentenCount(
  db: D1Database
): Promise<StoredCountRow> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total_count,
              COUNT(DISTINCT source_id) AS unique_count
       FROM matool_snapshots
       WHERE area = 'interessenten'`
    )
    .first<StoredCountRow>();
  if (!row) {
    throw new AppError(
      "matool_interessenten_count_failed",
      503,
      "Der Interessentenbestand konnte nicht gezaehlt werden."
    );
  }
  return row;
}

async function getExistingSnapshotRun(
  db: D1Database,
  runId: string
): Promise<ExistingSnapshotRunRow | null> {
  return db
    .prepare(
      `SELECT run.status,
              run.fetched_count,
              COUNT(*) FILTER (WHERE changes.change_kind = 'created') AS created_count,
              COUNT(*) FILTER (WHERE changes.change_kind = 'updated') AS updated_count
       FROM matool_snapshot_runs AS run
       LEFT JOIN matool_snapshot_changes AS changes
         ON changes.run_id = run.run_id
       WHERE run.run_id = ?
       GROUP BY run.run_id, run.status, run.fetched_count`
    )
    .bind(runId)
    .first<ExistingSnapshotRunRow>();
}

function workflowInstanceIdForTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    throw new AppError(
      "invalid_interessenten_sync_time",
      400,
      "Der Startzeitpunkt ist ungueltig."
    );
  }
  return `isync_${Math.floor(timestamp / 3_600_000)}`;
}

function workflowInstanceIdFromJobId(jobId: string): string {
  const match = /^(isync_\d+)_c\d+$/u.exec(jobId);
  if (!match?.[1]) {
    throw new AppError(
      "invalid_interessenten_sync_job",
      503,
      "Der fortzusetzende Interessentenlauf ist ungueltig."
    );
  }
  return match[1];
}

function assertWorkflowInstanceId(instanceId: string): void {
  if (!/^isync_\d{1,20}$/u.test(instanceId)) {
    throw new NonRetryableError("invalid_interessenten_sync_instance");
  }
}
