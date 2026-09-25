import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCheckinPage } from "../src/matool/checkin";
import { MatoolClient } from "../src/matool/client";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { collectMatoolSnapshots } from "../src/worker/schedule";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

const encoder = new TextEncoder();

function checkinWeek(monday: string): Uint8Array {
  return encoder.encode(`<script>
    namenliste_montag = "${monday}";
    namenliste_dienstag = "";
    namenliste_mittwoch = "";
    namenliste_donnerstag = "";
    namenliste_freitag = "";
    namenliste_samstag = "";
    namenliste_sonntag = "";
  </script>`);
}

function mockCheckinPage(body: Uint8Array): void {
  vi.spyOn(MatoolClient.prototype, "extractCheckins").mockImplementation(
    async () => {
      const records = parseCheckinPage(body);
      return {
        area: "checkin",
        bodyBytes: body.byteLength,
        records,
        rowCount: records.length
      };
    }
  );
}

const testEnv = {
  ...env,
  MATOOL_EMAIL: "checkin-test@example.invalid",
  MATOOL_PASSWORD: "synthetic-checkin-password",
  OUTBOUND_DELIVERY_ENABLED: "false"
};

describe("Check-in-Sync ohne Anwesenheiten zum Wochenbeginn", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    {
      label: "sieben leere Tageslisten",
      monday: "",
      scheduledFor: "2026-09-14T08:00:00.000Z"
    },
    {
      label: "ausschliesslich noch nicht eingecheckte Personen",
      monday: "<div id='700001-20260921000000-1340'></div>",
      scheduledFor: "2026-09-21T08:00:00.000Z"
    }
  ])("speichert $label erfolgreich und erhaelt die Historie", async ({ monday, scheduledFor }) => {
    const seedRunId = `checkin_seed_${crypto.randomUUID()}`;
    const historicalRecord = parseCheckinPage(
      checkinWeek("<div id='700001-20260911182730-1340'></div>")
    )[0]!;
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: Object.keys(historicalRecord.payload),
      area: "checkin",
      finishedAt: "2026-09-11T17:00:00.000Z",
      observedAt: "2026-09-11T17:00:00.000Z",
      records: [historicalRecord],
      runId: seedRunId,
      startedAt: "2026-09-11T17:00:00.000Z"
    }, await storedPayloadCipher(env));
    mockCheckinPage(checkinWeek(monday));

    const result = await collectMatoolSnapshots(
      testEnv,
      Date.parse(scheduledFor),
      ["checkin"],
      "scheduled"
    );

    expect(result).toEqual({
      areas: [{ area: "checkin", status: "succeeded", storedCount: 0 }],
      failed: 0,
      storedTotal: 0,
      succeeded: 1
    });
    const storedRun = await env.DB
      .prepare(
        `SELECT runs.status, runs.fetched_count, runs.success_count,
              runs.failure_count, runs.error_code, sync.status AS sync_status
       FROM matool_snapshot_runs AS runs
       JOIN matool_sync_runs AS sync ON sync.sync_id = runs.sync_id
       WHERE runs.area = 'checkin' AND sync.scheduled_for = ?`
      )
      .bind(scheduledFor)
      .first();
    expect(storedRun).toEqual({
      status: "succeeded",
      fetched_count: 0,
      success_count: 0,
      failure_count: 0,
      error_code: null,
      sync_status: "succeeded"
    });
    const historicalSnapshot = await env.DB
      .prepare(
        "SELECT last_run_id FROM matool_snapshots WHERE area = 'checkin' AND source_id = ?"
      )
      .bind(historicalRecord.sourceId)
      .first();
    expect(historicalSnapshot).toEqual({ last_run_id: seedRunId });
  });

  it("weist eine unvollstaendige Wochenansicht weiterhin als Schemafehler ab", async () => {
    mockCheckinPage(encoder.encode('<script>namenliste_montag = "";</script>'));

    const result = await collectMatoolSnapshots(
      testEnv,
      Date.parse("2026-09-21T09:00:00.000Z"),
      ["checkin"],
      "scheduled"
    );

    expect(result).toEqual({
      areas: [
        {
          area: "checkin",
          status: "failed",
          errorCode: "matool_checkin_schema_mismatch"
        }
      ],
      failed: 1,
      storedTotal: 0,
      succeeded: 0
    });
  });
});
