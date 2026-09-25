import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getDashboardOverview } from "../src/worker/dashboard-repository";
import {
  persistMatoolSnapshotRun,
  recordMatoolSnapshotFailure
} from "../src/worker/matool-store";
import { MATOOL_SNAPSHOT_AREAS } from "../src/worker/schedule";
import {
  beginMatoolSyncRun,
  finishMatoolSyncRun,
  recordSkippedMatoolSync
} from "../src/worker/sync-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

const scheduledFor = "2026-09-23T10:00:00.000Z";
const now = new Date("2026-09-23T10:10:00.000Z");
const runtime = {
  ...env,
  MATOOL_EMAIL: "synthetic@example.invalid",
  MATOOL_PASSWORD: "synthetic-test-password",
  MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only",
  OUTBOUND_DELIVERY_ENABLED: "false"
};

async function seedHealthySync(): Promise<void> {
  const syncId = await beginMatoolSyncRun(env.DB, {
    scheduledFor,
    startedAt: scheduledFor,
    trigger: "scheduled"
  });
  for (const area of MATOOL_SNAPSHOT_AREAS) {
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["status"],
      area,
      finishedAt: scheduledFor,
      observedAt: scheduledFor,
      records: [{ payload: { status: "SYNTHETISCH" }, sourceId: "700001" }],
      runId: `health_${area}_${crypto.randomUUID()}`,
      startedAt: scheduledFor,
      syncId
    }, await storedPayloadCipher(env));
  }
  await finishMatoolSyncRun(env.DB, syncId, scheduledFor, {
    failed: 0,
    storedTotal: MATOOL_SNAPSHOT_AREAS.length,
    succeeded: MATOOL_SNAPSHOT_AREAS.length,
    totalAreas: MATOOL_SNAPSHOT_AREAS.length
  });
}

describe("Dashboard-Gesundheit und bewusst deaktivierte Funktionen", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM matool_snapshot_changes"),
      env.DB.prepare("DELETE FROM matool_snapshots"),
      env.DB.prepare("DELETE FROM matool_snapshot_runs"),
      env.DB.prepare("DELETE FROM matool_sync_runs"),
      env.DB.prepare("DELETE FROM outbox"),
      env.DB.prepare("DELETE FROM events"),
      env.DB.prepare("DELETE FROM records"),
      env.DB.prepare("DELETE FROM runs")
    ]);
  });

  it("zaehlt deaktivierte Kontaktfunktionen und uebersprungene Zeiten nicht als Fehler", async () => {
    await seedHealthySync();
    // A legacy contact failure remains in its own history; it is not a
    // failed MATOOL sync and does not make the disabled feature unhealthy.
    const contactRun = `contact_${crypto.randomUUID()}`;
    const eventId = `event_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO runs (run_id, collector, mode, trigger_kind, status,
                         started_at, finished_at, error_code)
       VALUES (?, 'interessenten_first_trial', 'active', 'test', 'failed',
               ?, ?, 'synthetic_contact_failure')`
    ).bind(contactRun, scheduledFor, scheduledFor).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO records (collector, source_key, source_revision,
           payload_version, payload_json, last_run_id, fencing_token)
         VALUES ('interessenten_first_trial', 'synthetic', 'r1', 1, '{}', ?, 1)`
      ).bind(contactRun),
      env.DB.prepare(
        `INSERT INTO events (event_id, collector, event_type, source_key,
           payload_version, payload_json, status, created_run_id, fencing_token)
         VALUES (?, 'interessenten_first_trial', 'synthetic', 'synthetic',
                 1, '{}', 'failed', ?, 1)`
      ).bind(eventId, contactRun),
      env.DB.prepare(
        `INSERT INTO outbox (outbox_id, event_id, destination, status)
         VALUES (?, ?, 'synthetic', 'permanent_failure')`
      ).bind(`outbox_${crypto.randomUUID()}`, eventId)
    ]);
    await recordSkippedMatoolSync(env.DB, {
      scheduledFor: "2026-09-23T06:00:00.000Z",
      reason: "outside_schedule_window"
    });

    const overview = await getDashboardOverview(runtime, 1, now);
    expect(overview).toMatchObject({
      overall: { state: "healthy", reasonCount: 0 },
      metrics: { failedRuns: 0, successfulRuns: 1 },
      connections: { zapier: { state: "healthy", outboundEnabled: false, pendingOutbox: 1 } },
      warnings: [],
      charts: { points: expect.arrayContaining([
        expect.objectContaining({ label: "2026-09-23", failed: 0, successful: 1 })
      ]) },
      functions: expect.arrayContaining([
        expect.objectContaining({ key: "first_trial_contact", state: "disabled" }),
        expect.objectContaining({ key: "zapier_outbound", state: "disabled" }),
        expect.objectContaining({ key: "zapier_claim_confirm", state: "disabled" }),
        expect.objectContaining({ key: "zapier_subscription_management", state: "disabled" })
      ])
    });
    // The same backlog becomes actionable when outbound processing is enabled.
    expect(await getDashboardOverview({ ...runtime, OUTBOUND_DELIVERY_ENABLED: "true" }, 1, now))
      .toMatchObject({
        overall: { state: "warning" },
        connections: { zapier: { state: "warning" } },
        metrics: { failedRuns: 0 },
        warnings: expect.arrayContaining([expect.objectContaining({ key: "zapier_state" })])
      });
  });

  it("zaehlt einen noch laufenden Abruf auch im Diagramm nicht als Fehler", async () => {
    await seedHealthySync();
    await beginMatoolSyncRun(env.DB, {
      scheduledFor,
      startedAt: "2026-09-23T10:05:00.000Z",
      trigger: "scheduled"
    });

    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      metrics: { failedRuns: 0, successfulRuns: 1 },
      charts: { points: expect.arrayContaining([
        expect.objectContaining({ label: "2026-09-23", failed: 0, successful: 1 })
      ]) }
    });
  });

  it("meldet einen echten Datenabruf-Fehler trotz deaktivierter Kontaktfunktionen", async () => {
    await seedHealthySync();
    const failedAt = "2026-09-23T10:06:00.000Z";
    const syncId = await beginMatoolSyncRun(env.DB, {
      scheduledFor,
      startedAt: failedAt,
      trigger: "scheduled"
    });
    await recordMatoolSnapshotFailure(env.DB, {
      area: "schueler_ex",
      errorCode: "synthetic_schema_error",
      finishedAt: failedAt,
      runId: `failed_${crypto.randomUUID()}`,
      startedAt: failedAt,
      syncId
    });
    await finishMatoolSyncRun(env.DB, syncId, failedAt, {
      failed: 1, storedTotal: 0, succeeded: 0, totalAreas: 1
    });

    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      overall: { state: "critical" },
      metrics: { failedRuns: 1, successfulRuns: 1 },
      charts: { points: expect.arrayContaining([
        expect.objectContaining({ label: "2026-09-23", failed: 1, successful: 1 })
      ]) },
      warnings: expect.arrayContaining([
        expect.objectContaining({ key: "area_schueler_ex", state: "critical" })
      ])
    });
  });

  it("weist den abgeschalteten Klassenabruf nicht als aktive Funktion aus", async () => {
    await seedHealthySync();
    expect(await getDashboardOverview(runtime, 1, now)).toMatchObject({
      functions: expect.arrayContaining([
        expect.objectContaining({
          key: "class_extraction", state: "disabled", lastRunAt: null
        })
      ])
    });
  });
});
