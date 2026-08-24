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

interface SnapshotChangeRow {
  change_kind: "created" | "updated";
  content_hash: string;
  payload_json: string;
  run_id: string;
  zapier_event_id: string;
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

  it("speichert vollstaendige grosse Detailwerte, bleibt aber strikt begrenzt", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const area = `schueler_details_${suffix}`;
    const acceptedValue = "x".repeat(32_000);
    await expect(
      persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: ["klassenliste"],
        area,
        finishedAt: "2026-08-24T10:00:02.000Z",
        observedAt: "2026-08-24T10:00:01.000Z",
        records: [
          {
            sourceId: "700001",
            payload: { klassenliste: acceptedValue }
          }
        ],
        runId: `large_${suffix}`,
        startedAt: "2026-08-24T10:00:00.000Z"
      })
    ).resolves.toMatchObject({ storedCount: 1 });

    await expect(
      persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: ["klassenliste"],
        area,
        finishedAt: "2026-08-24T11:00:02.000Z",
        observedAt: "2026-08-24T11:00:01.000Z",
        records: [
          {
            sourceId: "700002",
            payload: { klassenliste: "x".repeat(256_001) }
          }
        ],
        runId: `oversize_${suffix}`,
        startedAt: "2026-08-24T11:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "invalid_matool_snapshot" });
  });

  it("speichert A-B-A als drei eigenstaendige Zapier-Ereignisse", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const area = `interessenten_${suffix}`;
    const sourceId = "900003";
    const statuses = ["A", "B", "A", "A"] as const;

    for (const [index, status] of statuses.entries()) {
      const hour = 8 + index;
      const timestamp = `2026-07-30T${hour.toString().padStart(2, "0")}:00:00.000Z`;
      await persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: ["status"],
        area,
        finishedAt: timestamp,
        observedAt: timestamp,
        records: [{ sourceId, payload: { status } }],
        runId: `run_${suffix}_${index + 1}`,
        startedAt: timestamp
      });
    }

    const changes = await env.DB
      .prepare(
        `SELECT run_id, change_kind, content_hash, payload_json,
                zapier_event_id
         FROM matool_snapshot_changes
         WHERE area = ? AND source_id = ?
         ORDER BY change_id`
      )
      .bind(area, sourceId)
      .all<SnapshotChangeRow>();

    expect(changes.results).toHaveLength(3);
    expect(changes.results.map((change) => change.change_kind)).toEqual([
      "created",
      "updated",
      "updated"
    ]);
    expect(changes.results.map((change) => change.payload_json)).toEqual([
      '{"status":"A"}',
      '{"status":"B"}',
      '{"status":"A"}'
    ]);
    expect(changes.results[0]?.content_hash).toBe(
      changes.results[2]?.content_hash
    );
    expect(
      changes.results.every((change) =>
        /^[a-f0-9]{64}$/u.test(change.zapier_event_id)
      )
    ).toBe(true);
    expect(
      new Set(changes.results.map((change) => change.zapier_event_id)).size
    ).toBe(3);
    expect(changes.results.map((change) => change.run_id)).toEqual([
      `run_${suffix}_1`,
      `run_${suffix}_2`,
      `run_${suffix}_3`
    ]);
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

const EXACT_NON_INTERESSENTEN_AREAS = [
  "archiv",
  "artikel",
  "klassen",
  "lager",
  "newsletter",
  "schueler"
] as const;

describe.sequential("atomarer Ersatz vollstaendiger MATOOL-Listen", () => {
  it("ersetzt jeden freigegebenen Nicht-Interessentenbereich exakt und idempotent", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");

    for (const area of EXACT_NON_INTERESSENTEN_AREAS) {
      const oldId = `${area}_old_${suffix}`;
      const sharedId = `${area}_shared_${suffix}`;
      const newId = `${area}_new_${suffix}`;
      await persistMatoolSnapshotRun(
        env.DB,
        exactSnapshotInput(
          area,
          `seed_${area}_${suffix}`,
          [
            { sourceId: oldId, value: "old" },
            { sourceId: sharedId, value: "old" }
          ],
          false
        )
      );

      const input = exactSnapshotInput(
        area,
        `replace_${area}_${suffix}`,
        [
          { sourceId: sharedId, value: "current" },
          { sourceId: newId, value: "new" }
        ],
        true
      );
      const first = await persistMatoolSnapshotRun(env.DB, input);
      const retry = await persistMatoolSnapshotRun(env.DB, input);

      expect(first, area).toEqual({
        createdCount: 1,
        staleRemovedCount: 1,
        storedCount: 2,
        updatedCount: 1
      });
      expect(retry, area).toEqual(first);

      const rows = await env.DB
        .prepare(
          `SELECT source_id, payload_json, last_run_id
           FROM matool_snapshots
           WHERE area = ?
           ORDER BY source_id`
        )
        .bind(area)
        .all<Pick<SnapshotRow, "last_run_id" | "payload_json" | "source_id">>();
      expect(rows.results, area).toEqual([
        {
          last_run_id: input.runId,
          payload_json: '{"value":"new"}',
          source_id: newId
        },
        {
          last_run_id: input.runId,
          payload_json: '{"value":"current"}',
          source_id: sharedId
        }
      ]);
    }
  });

  it("isoliert den Ersatz strikt auf den angeforderten Bereich", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const artikelId = `artikel_${suffix}`;
    await persistMatoolSnapshotRun(
      env.DB,
      exactSnapshotInput(
        "artikel",
        `artikel_seed_${suffix}`,
        [{ sourceId: artikelId, value: "unveraendert" }],
        false
      )
    );
    await persistMatoolSnapshotRun(
      env.DB,
      exactSnapshotInput(
        "schueler",
        `schueler_seed_${suffix}`,
        [{ sourceId: `schueler_alt_${suffix}`, value: "alt" }],
        false
      )
    );

    await persistMatoolSnapshotRun(
      env.DB,
      exactSnapshotInput(
        "schueler",
        `schueler_replace_${suffix}`,
        [{ sourceId: `schueler_neu_${suffix}`, value: "neu" }],
        true
      )
    );

    const artikel = await env.DB
      .prepare(
        `SELECT source_id, payload_json
         FROM matool_snapshots
         WHERE area = 'artikel' AND source_id = ?`
      )
      .bind(artikelId)
      .first<Pick<SnapshotRow, "payload_json" | "source_id">>();
    expect(artikel).toEqual({
      payload_json: '{"value":"unveraendert"}',
      source_id: artikelId
    });
  });

  it("weist leere Ersatzmengen sowie unbekannte und noch nicht exakt belegte Bereiche vor DB-Schreibzugriff ab", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const emptyRunId = `empty_${suffix}`;
    const unknownRunId = `unknown_${suffix}`;

    await expect(
      persistMatoolSnapshotRun(
        env.DB,
        exactSnapshotInput("artikel", emptyRunId, [], true)
      )
    ).rejects.toMatchObject({ code: "invalid_matool_snapshot" });
    await expect(
      persistMatoolSnapshotRun(
        env.DB,
        exactSnapshotInput(
          "checkin",
          `unverified_${suffix}`,
          [{ sourceId: `checkin_${suffix}`, value: "x" }],
          true
        )
      )
    ).rejects.toMatchObject({ code: "invalid_matool_snapshot" });
    await expect(
      persistMatoolSnapshotRun(
        env.DB,
        exactSnapshotInput(
          "nicht_freigegeben",
          unknownRunId,
          [{ sourceId: `id_${suffix}`, value: "x" }],
          true
        )
      )
    ).rejects.toMatchObject({ code: "invalid_matool_snapshot" });

    const writtenRuns = await env.DB
      .prepare(
        `SELECT run_id
         FROM matool_snapshot_runs
         WHERE run_id IN (?, ?)`
      )
      .bind(emptyRunId, unknownRunId)
      .all<{ run_id: string }>();
    expect(writtenRuns.results).toEqual([]);
  });

  it("rollt Upserts, Aenderungen, Lauf und Ergebnis bei spaetem Loeschfehler atomar zurueck", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const keepId = `keep_${suffix}`;
    const staleId = `stale_${suffix}`;
    const newId = `new_${suffix}`;
    const seedRunId = `seed_lager_${suffix}`;
    const failedRunId = `failed_lager_${suffix}`;
    const triggerName = `abort_stale_delete_${suffix}`;
    await persistMatoolSnapshotRun(
      env.DB,
      exactSnapshotInput(
        "lager",
        seedRunId,
        [
          { sourceId: keepId, value: "before" },
          { sourceId: staleId, value: "stale" }
        ],
        false
      )
    );

    await env.DB
      .prepare(
        `CREATE TRIGGER ${triggerName}
         BEFORE DELETE ON matool_snapshots
         WHEN OLD.area = 'lager' AND OLD.source_id = '${staleId}'
         BEGIN
           SELECT RAISE(ABORT, 'forced atomic rollback');
         END`
      )
      .run();
    try {
      await expect(
        persistMatoolSnapshotRun(
          env.DB,
          exactSnapshotInput(
            "lager",
            failedRunId,
            [
              { sourceId: keepId, value: "after" },
              { sourceId: newId, value: "new" }
            ],
            true
          )
        )
      ).rejects.toMatchObject({
        code: "matool_snapshot_persistence_failed"
      });
    } finally {
      await env.DB.prepare(`DROP TRIGGER ${triggerName}`).run();
    }

    const snapshots = await env.DB
      .prepare(
        `SELECT source_id, payload_json, last_run_id
         FROM matool_snapshots
         WHERE area = 'lager' AND source_id IN (?, ?, ?)
         ORDER BY source_id`
      )
      .bind(keepId, staleId, newId)
      .all<Pick<SnapshotRow, "last_run_id" | "payload_json" | "source_id">>();
    expect(snapshots.results).toEqual([
      {
        last_run_id: seedRunId,
        payload_json: '{"value":"before"}',
        source_id: keepId
      },
      {
        last_run_id: seedRunId,
        payload_json: '{"value":"stale"}',
        source_id: staleId
      }
    ]);

    const failedRunRows = await env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM matool_snapshot_runs WHERE run_id = ?) AS runs,
           (SELECT COUNT(*) FROM matool_snapshot_changes WHERE run_id = ?) AS changes,
           (SELECT COUNT(*) FROM matool_snapshot_run_results WHERE run_id = ?) AS results`
      )
      .bind(failedRunId, failedRunId, failedRunId)
      .first<{ changes: number; results: number; runs: number }>();
    expect(failedRunRows).toEqual({ changes: 0, results: 0, runs: 0 });
  });

  it("behaelt die bestehende Interessenten-Ersatz- und Retry-Semantik bei", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "_");
    const staleId = `stale_${suffix}`;
    const currentId = `current_${suffix}`;
    await persistMatoolSnapshotRun(
      env.DB,
      exactSnapshotInput(
        "interessenten",
        `interest_seed_${suffix}`,
        [
          { sourceId: staleId, value: "stale" },
          { sourceId: currentId, value: "current" }
        ],
        false
      )
    );
    const input = exactSnapshotInput(
      "interessenten",
      `interest_replace_${suffix}`,
      [{ sourceId: currentId, value: "current" }],
      true
    );

    const first = await persistMatoolSnapshotRun(env.DB, input);
    expect(first).toEqual({
      createdCount: 0,
      staleRemovedCount: 1,
      storedCount: 1,
      updatedCount: 0
    });
    await expect(persistMatoolSnapshotRun(env.DB, input)).resolves.toEqual(
      first
    );

    const current = await env.DB
      .prepare(
        `SELECT source_id
         FROM matool_snapshots
         WHERE area = 'interessenten'`
      )
      .all<{ source_id: string }>();
    expect(current.results).toEqual([{ source_id: currentId }]);
  });
});

function exactSnapshotInput(
  area: string,
  runId: string,
  records: readonly { sourceId: string; value: string }[],
  replaceCurrentSet: boolean
) {
  const timestamp = "2026-08-24T12:00:00.000Z";
  return {
    allowedPayloadFields: ["value"],
    area,
    finishedAt: timestamp,
    observedAt: timestamp,
    records: records.map(({ sourceId, value }) => ({
      payload: { value },
      sourceId
    })),
    ...(replaceCurrentSet ? { replaceCurrentSet: true } : {}),
    runId,
    startedAt: timestamp
  };
}
