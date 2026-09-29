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
import { storedPayloadCipher } from "../src/worker/payload-encryption";

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
    const first = await persistMatoolSnapshotRun(env.DB, input, await storedPayloadCipher(env));
    const retry = await persistMatoolSnapshotRun(env.DB, input, await storedPayloadCipher(env));

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
      ),
      await storedPayloadCipher(env)
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
      ),
      await storedPayloadCipher(env)
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

  it("liest im Folgejob nur neue, geaenderte, zu alte und die neuesten Details", async () => {
    const suffix = testSuffix();
    await env.DB.prepare(
      `UPDATE interessenten_sync_jobs
       SET status = 'failed', finished_at = '2026-08-25T00:00:00.000Z'
       WHERE status = 'running'`
    ).run();
    const ids = Array.from({ length: 200 }, (_, index) => String(5001 + index));
    const listRunId = `delta_list_${suffix}`;
    const persisted = await persistMatoolSnapshotRun(
      env.DB,
      snapshotInput("interessenten", listRunId, ids, "2026-08-25T06:00:00.000Z", true),
      await storedPayloadCipher(env)
    );
    const jobId = `delta_job_${suffix}`;
    const jobStart = "2026-08-26T12:00:00.000Z";
    await startOrRestartInteressentenSyncJob(env.DB, {
      initialListCount: 200,
      initialListUniqueCount: 200,
      jobId,
      listCount: 200,
      listCreatedCount: persisted.createdCount,
      listDigest: "d".repeat(64),
      listRunId,
      listUpdatedCount: persisted.updatedCount,
      staleListRemovedCount: persisted.staleRemovedCount,
      startedAt: jobStart
    });
    await env.DB.prepare(
      "DELETE FROM matool_snapshots WHERE area = 'interessenten_details'"
    ).run();
    // Frisch und nicht unter den 150 neuesten: bleibt.
    await persistRecords("interessenten_details", `d1_${suffix}`, ["5001"], "2026-08-26T10:00:00.000Z");
    // Vor der letzten Aenderung der Listenzeile gelesen: neu lesen.
    await persistRecords("interessenten_details", `d2_${suffix}`, ["5002"], "2026-08-25T05:59:00.000Z");
    // 5003 fehlt ganz. 5004 ist aelter als 20 Stunden: neu lesen.
    await persistRecords("interessenten_details", `d4_${suffix}`, ["5004"], "2026-08-25T07:00:00.000Z");
    // Neuester Interessent, vor Jobbeginn gelesen: neu lesen.
    await persistRecords("interessenten_details", `d200_${suffix}`, ["5200"], "2026-08-26T11:00:00.000Z");
    // Alle uebrigen in diesem Job bereits gelesen.
    await persistRecords(
      "interessenten_details",
      `drest_${suffix}`,
      ids.filter((id) => !["5001", "5002", "5003", "5004", "5200"].includes(id)),
      "2026-08-26T12:05:00.000Z"
    );

    expect(await selectInteressentenSyncDetailSourceIds(env.DB, jobId, 50)).toEqual([
      "5003",
      "5002",
      "5004",
      "5200"
    ]);
    await expect(getInteressentenSyncParity(env.DB, jobId)).resolves.toMatchObject({
      missingDetails: 1,
      staleDetails: 3
    });
    const offen = await finalizeInteressentenSyncJob(env.DB, jobId, "2026-08-26T12:10:00.000Z");
    expect(offen.completed).toBe(false);

    await persistRecords(
      "interessenten_details",
      `dfix_${suffix}`,
      ["5002", "5003", "5004", "5200"],
      "2026-08-26T12:06:00.000Z"
    );
    expect(await selectInteressentenSyncDetailSourceIds(env.DB, jobId, 50)).toEqual([]);
    const fertig = await finalizeInteressentenSyncJob(env.DB, jobId, "2026-08-26T12:11:00.000Z");
    expect(fertig.completed).toBe(true);
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
    snapshotInput(area, runId, sourceIds, observedAt),
    await storedPayloadCipher(env)
  );
}

function testSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "_");
}
