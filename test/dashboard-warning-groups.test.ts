import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getDashboardOverview, listDashboardActivities } from "../src/worker/dashboard-repository";
import { persistMatoolSnapshotRun, recordMatoolSnapshotFailure } from "../src/worker/matool-store";
import { MATOOL_SNAPSHOT_AREAS } from "../src/worker/schedule";
import { beginMatoolSyncRun, finishMatoolSyncRun } from "../src/worker/sync-store";

const now = new Date("2026-09-23T10:30:00.000Z");
const runtime = {
  ...env,
  MATOOL_EMAIL: "synthetic@example.invalid",
  MATOOL_PASSWORD: "synthetic-test-password",
  MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only",
  OUTBOUND_DELIVERY_ENABLED: "false"
};
type Area = typeof MATOOL_SNAPSHOT_AREAS[number];

async function seedSync(
  startedAt: string,
  failures: Partial<Record<Area, string>> = {},
  options: {
    failedAreaCount?: number;
    failureLast?: boolean;
    linkFailures?: boolean;
    scheduleError?: string;
    trigger?: "manual" | "scheduled";
  } = {}
): Promise<void> {
  const trigger = options.trigger ?? "scheduled";
  const syncId = await beginMatoolSyncRun(env.DB, {
    ...(trigger === "scheduled" ? { scheduledFor: startedAt } : {}),
    startedAt,
    trigger
  });
  const areas = [...MATOOL_SNAPSHOT_AREAS];
  if (options.failureLast) {
    areas.sort((left, right) => Number(Boolean(failures[left])) - Number(Boolean(failures[right])));
  }
  for (const [index, area] of areas.entries()) {
    const at = new Date(Date.parse(startedAt) + index * 1_000).toISOString();
    const runId = `warning_group_${area}_${crypto.randomUUID()}`;
    const errorCode = failures[area];
    if (errorCode) {
      await recordMatoolSnapshotFailure(env.DB, {
        area, errorCode, finishedAt: at, runId, startedAt: at,
        ...(options.linkFailures === false ? {} : { syncId })
      });
    } else {
      await persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: ["status"], area, finishedAt: at, observedAt: at,
        records: [{ payload: { status: "SYNTHETISCH" }, sourceId: "700001" }],
        runId, startedAt: at, syncId
      });
    }
  }
  const failed = options.failedAreaCount ?? Object.keys(failures).length;
  const succeeded = areas.length - failed;
  await finishMatoolSyncRun(env.DB, syncId,
    new Date(Date.parse(startedAt) + 10_000).toISOString(), {
      failed, storedTotal: succeeded, succeeded, totalAreas: areas.length
    });
  if (options.scheduleError) {
    await env.DB.prepare("UPDATE matool_sync_runs SET error_code = ? WHERE sync_id = ?")
      .bind(options.scheduleError, syncId).run();
  }
}

describe("Dashboard-Warnungen nach belegter Ursache", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM matool_snapshot_changes"),
      env.DB.prepare("DELETE FROM matool_snapshots"),
      env.DB.prepare("DELETE FROM matool_snapshot_runs"),
      env.DB.prepare("DELETE FROM matool_sync_runs")
    ]);
  });

  it("zeigt elf gleiche Bereichsfehler als eine Ursache, behaelt aber alle Laufereignisse", async () => {
    for (let minute = 0; minute < 11; minute += 1) {
      await seedSync(`2026-09-23T10:${String(minute).padStart(2, "0")}:00.000Z`, {
        schueler_ex: "synthetic_schema_error"
      });
    }

    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { state: "critical", reasonCount: 1 },
      connections: { matool: { state: "healthy" }, schedule: { state: "warning" } },
      metrics: { failedRuns: 11 },
      warnings: [{
        key: "area_schueler_ex", technicalCode: "synthetic_schema_error",
        occurrenceCount: 11,
        firstOccurredAt: "2026-09-23T10:00:04.000Z",
        lastOccurredAt: "2026-09-23T10:10:04.000Z",
        occurredAt: "2026-09-23T10:10:04.000Z"
      }]
    });
    // Grouping current warnings must not erase the area or overall audit trail.
    expect(await listDashboardActivities(runtime, { page: 1, pageSize: 50, kind: "sync", status: "failed" }))
      .toMatchObject({ total: 11 });
    expect(await listDashboardActivities(runtime, { page: 1, pageSize: 50, kind: "automation", status: "warning" }))
      .toMatchObject({ total: 11 });
  });

  it("fasst auch die abhaengige rote MATOOL-Karte nur bei belegter Laufzuordnung zusammen", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, { failureLast: true });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { state: "critical", reasonCount: 1 },
      connections: { matool: { state: "critical" }, schedule: { state: "warning" } },
      warnings: [{ key: "area_schueler_ex", occurrenceCount: 1 }]
    });
  });

  it("behaelt denselben Fehlercode in zwei Bereichen als zwei Ursachen", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", {
      schueler_ex: "invalid_matool_snapshot", checkin: "invalid_matool_snapshot"
    }, { failureLast: true });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [
        { key: "area_schueler_ex", technicalCode: "invalid_matool_snapshot", occurrenceCount: 1 },
        { key: "area_checkin", technicalCode: "invalid_matool_snapshot", occurrenceCount: 1 }
      ]
    });
  });

  it.each([
    { MATOOL_PASSWORD: "" },
    { MATOOL_REAL_RUNS_ENABLED: "false" }
  ])("behaelt eine unabhaengige MATOOL-Konfigurationsstoerung: %j", async (config) => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, { failureLast: true });
    expect(await getDashboardOverview({ ...runtime, ...config }, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [{ key: "matool_state" }, { key: "area_schueler_ex" }]
    });
  });

  it("behaelt einen eigenstaendigen Zeitplanfehler trotz verknuepftem Bereichsfehler", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, {
      failureLast: true, scheduleError: "synthetic_schedule_error"
    });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [
        { key: "schedule_state", technicalCode: "synthetic_schedule_error" },
        { key: "area_schueler_ex" }
      ]
    });
  });

  it("behaelt Sammelwarnungen ohne nachgewiesene Elternlauf-Zuordnung", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, {
      failureLast: true, linkFailures: false
    });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 3 },
      warnings: [{ key: "matool_state" }, { key: "schedule_state" }, { key: "area_schueler_ex" }]
    });
  });

  it("behaelt die Zeitplanwarnung, wenn nicht alle gemeldeten Bereichsfehler erklaert sind", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, {
      failureLast: true, failedAreaCount: 2
    });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [{ key: "schedule_state" }, { key: "area_schueler_ex" }]
    });
  });

  it("ordnet einen manuellen Bereichsfehler nicht einem anderen geplanten Lauf zu", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" });
    await seedSync("2026-09-23T10:10:00.000Z", { schueler_ex: "synthetic_schema_error" }, {
      trigger: "manual", failureLast: true
    });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [{ key: "schedule_state" }, { key: "area_schueler_ex", occurrenceCount: 2 }]
    });
  });

  it("behaelt einen verspaeteten Zeitplan als eigenstaendige Warnung", async () => {
    await seedSync("2026-09-22T10:00:00.000Z");
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, {
      trigger: "manual", failureLast: true
    });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 2 },
      warnings: [{ key: "schedule_state", technicalCode: null }, { key: "area_schueler_ex" }]
    });
  });

  it("absorbiert keinen inzwischen ueberfaelligen Zeitplan in einen alten Bereichsfehler", async () => {
    await seedSync("2026-09-22T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" }, { failureLast: true });
    const overview = await getDashboardOverview(runtime, 1, now);
    expect(overview.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "schedule_state" }),
      expect.objectContaining({
        key: "area_schueler_ex", occurrenceCount: 0,
        firstOccurredAt: null, lastOccurredAt: null,
        occurredAt: "2026-09-22T10:00:06.000Z"
      })
    ]));
    // The other old areas also remain stale; the group count covers them all.
    expect(overview).toMatchObject({ overall: { reasonCount: 8 } });
    expect(overview.warnings).toHaveLength(8);
  });

  it("behaelt fehlende Laufbestaetigungen als unknown und erfindet keine Fehlergruppe", async () => {
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { state: "unknown", reasonCount: 9 }, warnings: []
    });
  });

  it("zaehlt nur Wiederholungen desselben Codes im gewaehlten Zeitraum", async () => {
    await seedSync("2026-09-22T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" });
    await seedSync("2026-09-23T09:00:00.000Z", { schueler_ex: "synthetic_other_error" });
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" });
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { reasonCount: 1 },
      metrics: { failedRuns: 2 },
      warnings: [{
        key: "area_schueler_ex", technicalCode: "synthetic_schema_error", occurrenceCount: 1,
        firstOccurredAt: "2026-09-23T10:00:04.000Z", lastOccurredAt: "2026-09-23T10:00:04.000Z"
      }]
    });
    expect(await getDashboardOverview(runtime, 7, now)).toMatchObject({
      warnings: [{ key: "area_schueler_ex", occurrenceCount: 2,
        firstOccurredAt: "2026-09-22T10:00:04.000Z", lastOccurredAt: "2026-09-23T10:00:04.000Z" }]
    });
  });

  it("entfernt nach erfolgreichem Folgelauf die offene Ursache, nicht die historischen Fehler", async () => {
    await seedSync("2026-09-23T10:00:00.000Z", { schueler_ex: "synthetic_schema_error" });
    await seedSync("2026-09-23T10:10:00.000Z");
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { state: "healthy", reasonCount: 0 },
      metrics: { failedRuns: 1, successfulRuns: 1 }, warnings: []
    });
  });
});
