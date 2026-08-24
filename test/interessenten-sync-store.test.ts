import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  addInteressentenSyncJobProgress,
  failInteressentenSyncJob,
  finalizeInteressentenSyncJob,
  getCurrentInteressentenSyncJob,
  getInteressentenSyncParity,
  selectInteressentenSyncDetailSourceIds,
  startOrRestartInteressentenSyncJob
} from "../src/worker/interessenten-sync-store";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";

const ALLOWED_FIELDS = ["value"];

describe.sequential("fortsetzbarer vollstaendiger Interessentenabgleich", () => {
  it("ersetzt nur opt-in den aktuellen Listenbestand und ist mit gleicher runId idempotent", async () => {
    const suffix = testSuffix();
    await persistRecords(
      "interessenten",
      `old_${suffix}`,
      ["101", "102"],
      "2026-08-24T08:00:00.000Z"
    );

    const input = snapshotInput(
      "interessenten",
      `list_${suffix}`,
      ["102", "103"],
      "2026-08-24T09:00:00.000Z",
      true
    );
    const first = await persistMatoolSnapshotRun(env.DB, input);
    const retry = await persistMatoolSnapshotRun(env.DB, input);

    expect(first).toEqual({
      createdCount: 1,
      staleRemovedCount: 1,
      storedCount: 2,
      updatedCount: 0
    });
    expect(retry).toEqual(first);

    const current = await env.DB
      .prepare(
        `SELECT source_id
         FROM matool_snapshots
         WHERE area = 'interessenten'
         ORDER BY source_id`
      )
      .all<{ source_id: string }>();
    expect(current.results.map((row) => row.source_id)).toEqual(["102", "103"]);

    const removedHistory = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM matool_snapshot_changes
         WHERE area = 'interessenten' AND source_id = '101'`
      )
      .first<{ count: number }>();
    expect(removedHistory?.count).toBe(1);
  });

  it("waehlt nur fehlende oder alte aktuelle Details und zaehlt einen Batch exakt einmal", async () => {
    const suffix = testSuffix();
    const listRunId = `list_${suffix}`;
    const persisted = await persistMatoolSnapshotRun(
      env.DB,
      snapshotInput(
        "interessenten",
        listRunId,
        ["201", "202", "203"],
        "2026-08-24T10:00:00.000Z",
        true
      )
    );
    const jobId = `job_${suffix}`;
    await startOrRestartInteressentenSyncJob(env.DB, {
      initialListCount: 2,
      initialListUniqueCount: 2,
      jobId,
      listCount: 3,
      listCreatedCount: persisted.createdCount,
      listDigest: "a".repeat(64),
      listRunId,
      listUpdatedCount: persisted.updatedCount,
      staleListRemovedCount: persisted.staleRemovedCount,
      startedAt: "2026-08-24T10:01:00.000Z"
    });
    await persistRecords(
      "interessenten_details",
      `details_old_${suffix}`,
      ["201"],
      "2026-08-24T09:30:00.000Z"
    );
    await persistRecords(
      "interessenten_details",
      `details_new_${suffix}`,
      ["202", "999"],
      "2026-08-24T10:02:00.000Z"
    );

    expect(
      await selectInteressentenSyncDetailSourceIds(env.DB, jobId, 10)
    ).toEqual(["203", "201"]);

    const progress = {
      batchKey: `batch_${suffix}`,
      completedDetails: 2,
      created: 1,
      updated: 1,
      updatedAt: "2026-08-24T10:03:00.000Z"
    };
    await addInteressentenSyncJobProgress(env.DB, jobId, progress);
    await addInteressentenSyncJobProgress(env.DB, jobId, progress);
    const job = await getCurrentInteressentenSyncJob(env.DB);
    expect(job).toMatchObject({
      completedDetailCount: 2,
      createdCount: persisted.createdCount + 1,
      updatedCount: persisted.updatedCount + 1
    });

    await expect(
      startOrRestartInteressentenSyncJob(env.DB, {
        initialListCount: 3,
        initialListUniqueCount: 3,
        jobId: `other_${suffix}`,
        listCount: 3,
        listCreatedCount: persisted.createdCount,
        listDigest: "b".repeat(64),
        listRunId,
        listUpdatedCount: persisted.updatedCount,
        staleListRemovedCount: 0,
        startedAt: "2026-08-24T10:04:00.000Z"
      })
    ).rejects.toMatchObject({ code: "interessenten_sync_job_conflict" });

    await failInteressentenSyncJob(env.DB, jobId, {
      errorCode: "test_finished",
      finishedAt: "2026-08-24T10:05:00.000Z"
    });
  });

  it("entfernt verwaiste Details und schliesst nur bei exakter aktueller ID-Paritaet ab", async () => {
    const suffix = testSuffix();
    const listRunId = `list_${suffix}`;
    const persisted = await persistMatoolSnapshotRun(
      env.DB,
      snapshotInput(
        "interessenten",
        listRunId,
        ["301", "302"],
        "2026-08-24T11:00:00.000Z",
        true
      )
    );
    const jobId = `job_${suffix}`;
    await startOrRestartInteressentenSyncJob(env.DB, {
      initialListCount: 3,
      initialListUniqueCount: 3,
      jobId,
      listCount: 2,
      listCreatedCount: persisted.createdCount,
      listDigest: "c".repeat(64),
      listRunId,
      listUpdatedCount: persisted.updatedCount,
      staleListRemovedCount: persisted.staleRemovedCount,
      startedAt: "2026-08-24T11:01:00.000Z"
    });
    await persistRecords(
      "interessenten_details",
      `details_${suffix}`,
      ["301", "302", "399"],
      "2026-08-24T11:02:00.000Z"
    );

    const beforeFinalize = await getInteressentenSyncParity(env.DB, jobId);
    const finalized = await finalizeInteressentenSyncJob(
      env.DB,
      jobId,
      "2026-08-24T11:03:00.000Z"
    );
    expect(finalized.completed).toBe(true);
    expect(finalized.parity).toEqual({
      detailCount: 2,
      detailUnique: 2,
      expectedListCount: 2,
      extraDetails: 0,
      listCount: 2,
      listRunMismatch: 0,
      listUnique: 2,
      missingDetails: 0,
      nonNumericListIds: 0,
      staleDetails: 0
    });
    expect(finalized.job).toMatchObject({
      completedDetailCount: 2,
      staleDetailRemovedCount: beforeFinalize.extraDetails,
      status: "succeeded"
    });

    const orphanHistory = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM matool_snapshot_changes
         WHERE area = 'interessenten_details' AND source_id = '399'`
      )
      .first<{ count: number }>();
    expect(orphanHistory?.count).toBe(1);
  });
});

function snapshotInput(
  area: string,
  runId: string,
  sourceIds: readonly string[],
  observedAt: string,
  replaceCurrentSet = false
) {
  return {
    allowedPayloadFields: ALLOWED_FIELDS,
    area,
    finishedAt: observedAt,
    observedAt,
    records: sourceIds.map((sourceId) => ({
      payload: { value: sourceId },
      sourceId
    })),
    ...(replaceCurrentSet ? { replaceCurrentSet: true } : {}),
    runId,
    startedAt: observedAt
  };
}

async function persistRecords(
  area: string,
  runId: string,
  sourceIds: readonly string[],
  observedAt: string
): Promise<void> {
  await persistMatoolSnapshotRun(
    env.DB,
    snapshotInput(area, runId, sourceIds, observedAt)
  );
}

function testSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "_");
}
