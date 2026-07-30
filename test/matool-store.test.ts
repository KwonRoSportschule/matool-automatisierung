import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  persistMatoolSnapshotRun,
  recordMatoolSnapshotFailure
} from "../src/worker/matool-store";

interface SnapshotRow {
  area: string;
  content_hash: string;
  first_seen_at: string;
  last_run_id: string;
  last_seen_at: string;
  payload_json: string;
  source_id: string;
}

interface SnapshotRunRow {
  failure_count: number;
  fetched_count: number;
  status: string;
  success_count: number;
}

describe("generische MATOOL-Snapshots", () => {
  it("upsertet nach Bereich und Quell-ID und loescht fehlende Datensaetze nie", async () => {
    const suffix = crypto.randomUUID();
    const area = `interessenten_${suffix.replaceAll("-", "_")}`;
    const firstRunId = `run_${suffix.replaceAll("-", "_")}_1`;
    const secondRunId = `run_${suffix.replaceAll("-", "_")}_2`;
    const allowedPayloadFields = [
      "displayNumber",
      "createdDate",
      "firstName",
      "lastName",
      "status"
    ];

    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields,
      area,
      finishedAt: "2026-07-30T08:00:02.000Z",
      observedAt: "2026-07-30T08:00:01.000Z",
      records: [
        {
          sourceId: "900001",
          payload: {
            displayNumber: "4711",
            createdDate: "30.07.2026",
            firstName: "Alice",
            lastName: "Beispiel",
            status: "Neu"
          }
        },
        {
          sourceId: "900002",
          payload: {
            displayNumber: "4712",
            createdDate: "30.07.2026",
            firstName: "Bob",
            lastName: "Muster",
            status: "Neu"
          }
        }
      ],
      runId: firstRunId,
      startedAt: "2026-07-30T08:00:00.000Z"
    });

    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields,
      area,
      finishedAt: "2026-07-30T09:00:02.000Z",
      observedAt: "2026-07-30T09:00:01.000Z",
      records: [
        {
          sourceId: "900001",
          payload: {
            displayNumber: "4711",
            createdDate: "30.07.2026",
            firstName: "Alice",
            lastName: "Beispiel",
            status: "Kontaktiert"
          }
        }
      ],
      runId: secondRunId,
      startedAt: "2026-07-30T09:00:00.000Z"
    });

    const snapshots = await env.DB.prepare(
      `SELECT area, source_id, first_seen_at, last_seen_at,
              content_hash, payload_json, last_run_id
       FROM matool_snapshots
       WHERE area = ?
       ORDER BY source_id`
    )
      .bind(area)
      .all<SnapshotRow>();
    expect(snapshots.results).toHaveLength(2);
    expect(snapshots.results[0]).toMatchObject({
      area,
      source_id: "900001",
      first_seen_at: "2026-07-30T08:00:01.000Z",
      last_seen_at: "2026-07-30T09:00:01.000Z",
      last_run_id: secondRunId,
      payload_json:
        '{"createdDate":"30.07.2026","displayNumber":"4711","firstName":"Alice","lastName":"Beispiel","status":"Kontaktiert"}'
    });
    expect(snapshots.results[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshots.results[1]).toMatchObject({
      source_id: "900002",
      first_seen_at: "2026-07-30T08:00:01.000Z",
      last_seen_at: "2026-07-30T08:00:01.000Z",
      last_run_id: firstRunId
    });

    const runs = await env.DB.prepare(
      `SELECT status, fetched_count, success_count, failure_count
       FROM matool_snapshot_runs
       WHERE area = ?
       ORDER BY started_at`
    )
      .bind(area)
      .all<SnapshotRunRow>();
    expect(runs.results).toEqual([
      {
        status: "succeeded",
        fetched_count: 2,
        success_count: 2,
        failure_count: 0
      },
      {
        status: "succeeded",
        fetched_count: 1,
        success_count: 1,
        failure_count: 0
      }
    ]);
  });

  it("weist nicht freigegebene Payload-Felder vor jedem DB-Schreibzugriff ab", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const area = `interessenten_${suffix}`;

    await expect(
      persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: ["displayNumber", "status"],
        area,
        finishedAt: "2026-07-30T08:00:02.000Z",
        observedAt: "2026-07-30T08:00:01.000Z",
        records: [
          {
            sourceId: "900001",
            payload: {
              displayNumber: "4711",
              secretBankData: "PRIVATE-BANK-DATA",
              status: "Neu"
            }
          }
        ],
        runId: `run_${suffix}`,
        startedAt: "2026-07-30T08:00:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "invalid_matool_snapshot"
    });

    const run = await env.DB.prepare(
      "SELECT run_id FROM matool_snapshot_runs WHERE area = ?"
    )
      .bind(area)
      .first();
    const snapshot = await env.DB.prepare(
      "SELECT source_id FROM matool_snapshots WHERE area = ?"
    )
      .bind(area)
      .first();
    expect(run).toBeNull();
    expect(snapshot).toBeNull();
  });

  it("speichert einen fehlgeschlagenen Lauf mit atomaren Fehlerzaehlern", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const area = `interessenten_${suffix}`;

    await recordMatoolSnapshotFailure(env.DB, {
      area,
      errorCode: "matool_schema_mismatch",
      failureCount: 1,
      fetchedCount: 0,
      finishedAt: "2026-07-30T10:00:02.000Z",
      runId: `run_${suffix}`,
      startedAt: "2026-07-30T10:00:00.000Z"
    });

    const run = await env.DB.prepare(
      `SELECT status, fetched_count, success_count, failure_count
       FROM matool_snapshot_runs
       WHERE area = ?`
    )
      .bind(area)
      .first<SnapshotRunRow>();
    expect(run).toEqual({
      status: "failed",
      fetched_count: 0,
      success_count: 0,
      failure_count: 1
    });
  });
});
