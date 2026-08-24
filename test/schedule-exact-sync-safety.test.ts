import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acquireExactSyncLease,
  assertExactSourceBaseline,
  persistFencedExactSnapshotRun,
  readMatchingExactSource,
  releaseExactSyncLease,
  renewExactSyncLease
} from "../src/worker/exact-sync-safety";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";

describe.sequential("direkter Exact-Current-Set-Schutz", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM matool_exact_sync_fence_checks"),
      env.DB.prepare("DELETE FROM matool_exact_sync_leases")
    ]);
  });

  it("liest ueber zwei frische Sessions und akzeptiert nur exakt gleiche Records", async () => {
    const sessions: number[] = [];
    const cleared: number[] = [];
    const records = [
      { sourceId: "10", payload: { name: "A", status: "aktiv" } },
      { sourceId: "20", payload: { name: "B", status: "inaktiv" } }
    ];

    const result = await readMatchingExactSource(() => {
      const session = sessions.length + 1;
      sessions.push(session);
      return {
        clear: () => cleared.push(session),
        read: async () =>
          session === 1
            ? records
            : records.map((record) => ({
                payload: {
                  status: record.payload.status,
                  name: record.payload.name
                },
                sourceId: record.sourceId
              }))
      };
    });

    expect(result).toBe(records);
    expect(sessions).toEqual([1, 2]);
    expect(cleared).toEqual([1, 2]);
  });

  it("verwirft abweichende Reihenfolge oder Payload ohne Freigabe", async () => {
    let session = 0;
    await expect(
      readMatchingExactSource(() => {
        session += 1;
        return {
          clear: () => undefined,
          read: async () =>
            session === 1
              ? [
                  { sourceId: "10", payload: { value: "A" } },
                  { sourceId: "20", payload: { value: "B" } }
                ]
              : [
                  { sourceId: "20", payload: { value: "B" } },
                  { sourceId: "10", payload: { value: "A" } }
                ]
        };
      })
    ).rejects.toMatchObject({ code: "matool_exact_source_mismatch" });
  });

  it("blockiert einen unplausiblen Rueckgang gegenueber dem letzten erfolgreichen Lauf", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const timestamp = new Date().toISOString();
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["value"],
      area: "artikel",
      finishedAt: timestamp,
      observedAt: timestamp,
      records: Array.from({ length: 100 }, (_, index) => ({
        payload: { value: `baseline-${index}` },
        sourceId: `baseline_${suffix}_${index}`
      })),
      runId: `baseline_${suffix}`,
      startedAt: timestamp
    });

    await expect(
      assertExactSourceBaseline(env.DB, "artikel", 79)
    ).rejects.toMatchObject({
      code: "matool_exact_source_implausible_shrink"
    });
    await expect(
      assertExactSourceBaseline(env.DB, "artikel", 80)
    ).resolves.toBeUndefined();
  });

  it("blockiert Ueberlappung und erlaubt die Uebernahme einer stale Lease", async () => {
    const start = new Date("2026-08-24T10:00:00.000Z");
    const first = await acquireExactSyncLease(
      env.DB,
      "owner_first",
      start,
      1_000
    );

    await expect(
      acquireExactSyncLease(
        env.DB,
        "owner_second",
        new Date("2026-08-24T10:00:00.500Z"),
        1_000
      )
    ).rejects.toMatchObject({ code: "matool_exact_sync_busy" });

    const second = await acquireExactSyncLease(
      env.DB,
      "owner_second",
      new Date("2026-08-24T10:00:01.001Z"),
      1_000
    );
    expect(second.fencingToken).toBe(first.fencingToken + 1);
    await expect(releaseExactSyncLease(env.DB, first)).resolves.toBe(false);
    await expect(
      renewExactSyncLease(
        env.DB,
        first,
        new Date("2026-08-24T10:00:01.100Z"),
        1_000
      )
    ).rejects.toMatchObject({ code: "matool_exact_sync_lease_lost" });
    await expect(releaseExactSyncLease(env.DB, second)).resolves.toBe(true);
  });

  it("laesst einen alten Writer nach Lease-Uebernahme weder upserten noch loeschen", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const staleId = `stale_${suffix}`;
    const blockedId = `blocked_${suffix}`;
    const currentId = `current_${suffix}`;
    const seedRunId = `seed_${suffix}`;
    const blockedRunId = `blocked_${suffix}`;
    const currentRunId = `current_${suffix}`;
    const timestamp = new Date().toISOString();

    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["value"],
      area: "artikel",
      finishedAt: timestamp,
      observedAt: timestamp,
      records: [{ sourceId: staleId, payload: { value: "stale" } }],
      runId: seedRunId,
      startedAt: timestamp
    });

    const oldLease = await acquireExactSyncLease(
      env.DB,
      `old_${suffix}`,
      new Date(Date.now() - 5_000),
      1_000
    );
    const currentLease = await acquireExactSyncLease(
      env.DB,
      `current_${suffix}`,
      new Date(),
      60_000
    );

    await expect(
      persistFencedExactSnapshotRun(
        env.DB,
        oldLease,
        exactInput(blockedRunId, blockedId)
      )
    ).rejects.toMatchObject({
      code: "interessenten_sync_store_unavailable"
    });

    const blockedState = await env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM matool_snapshots
             WHERE area = 'artikel' AND source_id = ?) AS stale_count,
           (SELECT COUNT(*) FROM matool_snapshots
             WHERE area = 'artikel' AND source_id = ?) AS blocked_count,
           (SELECT COUNT(*) FROM matool_snapshot_runs
             WHERE run_id = ?) AS blocked_run_count`
      )
      .bind(staleId, blockedId, blockedRunId)
      .first<{
        blocked_count: number;
        blocked_run_count: number;
        stale_count: number;
      }>();
    expect(blockedState).toEqual({
      blocked_count: 0,
      blocked_run_count: 0,
      stale_count: 1
    });

    await expect(
      persistFencedExactSnapshotRun(
        env.DB,
        currentLease,
        exactInput(currentRunId, currentId)
      )
    ).resolves.toMatchObject({ staleRemovedCount: 1, storedCount: 1 });

    const finalIds = await env.DB
      .prepare(
        `SELECT source_id
         FROM matool_snapshots
         WHERE area = 'artikel'`
      )
      .all<{ source_id: string }>();
    expect(finalIds.results).toEqual([{ source_id: currentId }]);
    await expect(releaseExactSyncLease(env.DB, currentLease)).resolves.toBe(
      true
    );
  });
});

function exactInput(runId: string, sourceId: string) {
  const timestamp = new Date().toISOString();
  return {
    allowedPayloadFields: ["value"],
    area: "artikel",
    finishedAt: timestamp,
    observedAt: timestamp,
    records: [{ sourceId, payload: { value: "current" } }],
    replaceCurrentSet: true,
    runId,
    startedAt: timestamp
  };
}
