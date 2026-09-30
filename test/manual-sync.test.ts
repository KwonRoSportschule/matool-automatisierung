import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/worker";
import {
  createManualSyncJob,
  finishManualSyncJob,
  latestManualSyncJob,
  markManualSyncJob,
  openManualSyncJob
} from "../src/worker/direct-sync-store";
import type { Env } from "../src/worker/env";
import { isDirectSyncLeaseHeld } from "../src/worker/direct-sync-store";
import { acquireExactSyncLease, releaseExactSyncLease } from "../src/worker/exact-sync-safety";
import { berechneFortschritt, getSyncProgress } from "../src/worker/sync-progress";
import { waitForFreeDirectSyncLease } from "../src/worker/schedule";
import { beginMatoolSyncRun } from "../src/worker/sync-store";

async function dispatch(request: Request, runtimeEnv: Env): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, runtimeEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

const origin = "http://127.0.0.1";

describe("Manueller Abruf als Workflow", () => {
  beforeEach(async () => {
    await env.DB.prepare("DROP TABLE IF EXISTS matool_manual_sync_jobs").run();
  });

  it("legt einen Auftrag an, startet den Workflow und antwortet sofort", async () => {
    const gestartet: Array<{ id: string; params: unknown }> = [];
    const runtimeEnv = {
      ...env,
      MATOOL_EMAIL: "service@example.invalid",
      MATOOL_PASSWORD: "synthetic-password",
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only",
      DIRECT_SYNC_WORKFLOW: {
        create: async (options: { id: string; params: unknown }) => {
          gestartet.push(options);
          return { id: options.id };
        }
      }
    } as unknown as Env;

    const csrf = (await (
      await dispatch(new Request(`${origin}/api/admin/v1/csrf`), runtimeEnv)
    ).json()) as { token: string };
    const post = () =>
      dispatch(
        new Request(`${origin}/api/admin/v1/matool/sync`, {
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            "X-CSRF-Token": csrf.token
          },
          method: "POST"
        }),
        runtimeEnv
      );

    const erste = await post();
    expect(erste.status).toBe(202);
    const erstesJson = (await erste.json()) as { manual: { jobId: string; status: string } };
    expect(erstesJson.manual.status).toBe("requested");
    expect(gestartet).toHaveLength(1);
    expect(gestartet[0]?.id).toBe(erstesJson.manual.jobId);

    // Doppelklick: derselbe Auftrag, kein zweiter Workflow.
    const zweite = await post();
    expect(zweite.status).toBe(202);
    await expect(zweite.json()).resolves.toMatchObject({
      manual: { jobId: erstesJson.manual.jobId }
    });
    expect(gestartet).toHaveLength(1);

    const stand = await dispatch(new Request(`${origin}/api/admin/v1/matool/sync`), runtimeEnv);
    expect(stand.status).toBe(200);
    await expect(stand.json()).resolves.toMatchObject({
      schemaVersion: 1,
      manual: { jobId: erstesJson.manual.jobId, status: "requested" },
      progress: null
    });
  });

  it("fuehrt den Auftrag durch Warten, Laufen und Ergebnis", async () => {
    const jetzt = new Date("2098-06-01T10:00:00.000Z");
    await createManualSyncJob(env.DB, "manuell_test_1", jetzt);
    await markManualSyncJob(env.DB, "manuell_test_1", "waiting", jetzt);
    await expect(openManualSyncJob(env.DB, jetzt)).resolves.toMatchObject({ status: "waiting" });
    await markManualSyncJob(env.DB, "manuell_test_1", "running", new Date("2098-06-01T10:05:00.000Z"));
    await finishManualSyncJob(
      env.DB,
      "manuell_test_1",
      { failed: 1, failedAreas: ["schueler_ex"], storedTotal: 42, succeeded: 5 },
      new Date("2098-06-01T10:12:00.000Z")
    );
    await expect(openManualSyncJob(env.DB, new Date("2098-06-01T10:13:00.000Z"))).resolves.toBeNull();
    await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
      status: "partial_failed",
      startedAt: "2098-06-01T10:05:00.000Z",
      failedAreas: ["schueler_ex"],
      storedTotal: 42
    });
  });

  it("gibt einen verwaisten Auftrag nach einer Stunde frei", async () => {
    await createManualSyncJob(env.DB, "manuell_alt", new Date("2098-06-02T08:00:00.000Z"));
    await expect(openManualSyncJob(env.DB, new Date("2098-06-02T09:30:00.000Z"))).resolves.toBeNull();
    await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
      status: "failed",
      errorCode: "manual_sync_abandoned"
    });
  });
});

describe("Fortschritt des laufenden Abrufs", () => {
  const areas = ["schueler", "schueler_ex", "checkin", "graduierungen"];
  const lauf = (area: string, start: string, ende: string, status: "succeeded" | "failed" = "succeeded") => ({
    area,
    status,
    started_at: start,
    finished_at: ende,
    error_code: status === "failed" ? "synthetic_error" : null
  });

  it("schaetzt aus den letzten Laeufen und laesst den laufenden Bereich wachsen", () => {
    const fortschritt = berechneFortschritt({
      areas,
      done: [
        lauf("schueler", "2098-07-01T10:00:00.000Z", "2098-07-01T10:02:00.000Z"),
        lauf("schueler_ex", "2098-07-01T10:02:00.000Z", "2098-07-01T10:05:00.000Z", "failed")
      ],
      history: [
        lauf("checkin", "2098-06-30T10:05:00.000Z", "2098-06-30T10:06:00.000Z"),
        lauf("checkin", "2098-06-30T09:05:00.000Z", "2098-06-30T09:08:00.000Z"),
        lauf("graduierungen", "2098-06-30T10:06:00.000Z", "2098-06-30T10:16:00.000Z")
      ],
      now: new Date("2098-07-01T10:06:00.000Z"),
      startedAt: "2098-07-01T10:00:00.000Z",
      syncId: "sync_test",
      trigger: "scheduled"
    });

    expect(fortschritt.areas.map((area) => area.state)).toEqual(["done", "failed", "running", "waiting"]);
    // Check-ins: Durchschnitt 2 Min., seit 1 Min. unterwegs.
    expect(fortschritt.areas[2]).toMatchObject({ estimateMs: 120_000, fraction: 0.5 });
    expect(fortschritt.current).toEqual({ area: "checkin", label: "Check-ins" });
    expect(fortschritt.remainingMs).toBe(60_000 + 600_000);
    expect(fortschritt.estimatedFinishAt).toBe("2098-07-01T10:17:00.000Z");
    expect(fortschritt.percent).toBe(35);

    // Laenger als geschaetzt: Rest bleibt, Balken unter 100 %.
    const spaeter = berechneFortschritt({
      areas: ["checkin"],
      done: [],
      history: [lauf("checkin", "2098-06-30T10:05:00.000Z", "2098-06-30T10:06:00.000Z")],
      now: new Date("2098-07-01T10:10:00.000Z"),
      startedAt: "2098-07-01T10:00:00.000Z",
      syncId: "sync_test",
      trigger: "scheduled"
    });
    expect(spaeter.remainingMs).toBe(30_000);
    expect(spaeter.percent).toBeLessThan(100);
  });

  it("zeigt nur einen Lauf, waehrend die Sperre gehalten wird", async () => {
    const jetzt = new Date();
    const syncId = await beginMatoolSyncRun(env.DB, {
      startedAt: new Date(jetzt.getTime() - 60_000).toISOString(),
      trigger: "scheduled",
      scheduledFor: new Date(jetzt.getTime() - 60_000).toISOString()
    });
    await expect(getSyncProgress(env.DB, jetzt)).resolves.toBeNull();

    const lease = await acquireExactSyncLease(env.DB, `test_${crypto.randomUUID()}`);
    try {
      const fortschritt = await getSyncProgress(env.DB, jetzt);
      expect(fortschritt).toMatchObject({ syncId, trigger: "scheduled" });
      expect(fortschritt?.areas[0]).toMatchObject({ area: "schueler", state: "running" });
      expect(fortschritt?.areas.map((area) => area.area)).toEqual([
        "schueler",
        "schueler_ex",
        "checkin",
        "schueler_stilllegungen",
        "schueler_details",
        "graduierungen"
      ]);
    } finally {
      await releaseExactSyncLease(env.DB, lease);
      await env.DB.prepare("UPDATE matool_sync_runs SET status = 'failed', finished_at = ? WHERE sync_id = ?")
        .bind(jetzt.toISOString(), syncId)
        .run();
    }
  });
});

/** Erfolgreiche Ergebnisse fuer alle Bereichsschritte eines Laufs. */
async function mockeBereiche(
  m: { mockStepResult: (step: { name: string }, result: unknown) => Promise<void> },
  jeBereich: number,
  ausser: readonly string[] = []
): Promise<void> {
  const { MATOOL_DIRECT_SNAPSHOT_AREAS } = await import("../src/worker/schedule");
  for (const area of MATOOL_DIRECT_SNAPSHOT_AREAS) {
    if (!ausser.includes(area)) {
      await m.mockStepResult(
        { name: `bereich-${area}` },
        { area, status: "succeeded", storedCount: jeBereich }
      );
    }
  }
  // Der Interessentenabgleich ist ein eigener Workflow mit eigenem Test.
  await m.mockStepResult({ name: "interessenten" }, { status: "idle" });
}

describe("DirectSyncWorkflow", () => {
  it("wartet auf die Sperre, liest jeden Bereich als eigenen Schritt und speichert das Ergebnis", async () => {
    const { introspectWorkflowInstance } = await import("cloudflare:test");
    const workflow = (env as unknown as Env).DIRECT_SYNC_WORKFLOW!;
    const jobId = `manuell_wf_${Date.now()}`;
    await env.DB.prepare("DROP TABLE IF EXISTS matool_manual_sync_jobs").run();
    await createManualSyncJob(env.DB, jobId);
    // Ein anderer Abruf haelt die Sperre: erst warten, dann laufen.
    const lease = await acquireExactSyncLease(env.DB, `test_${crypto.randomUUID()}`);

    const instance = await introspectWorkflowInstance(workflow, jobId);
    try {
      await instance.modify(async (m) => {
        await m.disableSleeps();
        await mockeBereiche(m, 2);
        await m.mockStepResult({ name: "stilllegungen-offen-0" }, 0);
      });
      await workflow.create({ id: jobId, params: { jobId, requestedAt: new Date().toISOString() } });
      await expect(instance.waitForStepResult({ name: "sperre-pruefen-0" })).resolves.toBe(true);
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({ jobId, status: "waiting" });
      await releaseExactSyncLease(env.DB, lease);

      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({ failed: 0, storedTotal: 12, succeeded: 6 });
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
        jobId,
        status: "succeeded",
        storedTotal: 12,
        succeeded: 6
      });
      // Der Gesamtlauf ist abgeschlossen und die Sperre wieder frei.
      const lauf = await env.DB.prepare(
        "SELECT status, succeeded_area_count FROM matool_sync_runs ORDER BY started_at DESC LIMIT 1"
      ).first<{ status: string; succeeded_area_count: number }>();
      expect(lauf).toMatchObject({ status: "succeeded", succeeded_area_count: 6 });
      await expect(isDirectSyncLeaseHeld(env.DB)).resolves.toBe(false);
    } finally {
      await instance.dispose();
      await releaseExactSyncLease(env.DB, lease).catch(() => false);
    }
  });

  it("wiederholt nur den Bereich mit voruebergehendem Fehler", async () => {
    const { introspectWorkflowInstance } = await import("cloudflare:test");
    const workflow = (env as unknown as Env).DIRECT_SYNC_WORKFLOW!;
    const jobId = `manuell_retry_${Date.now()}`;
    await env.DB.prepare("DROP TABLE IF EXISTS matool_manual_sync_jobs").run();
    await createManualSyncJob(env.DB, jobId);
    const instance = await introspectWorkflowInstance(workflow, jobId);
    try {
      await instance.modify(async (m) => {
        await m.disableSleeps();
        await mockeBereiche(m, 1, ["checkin", "graduierungen"]);
        await m.mockStepResult(
          { name: "bereich-checkin" },
          { area: "checkin", errorCode: "matool_network_error", retryable: true, status: "failed" }
        );
        await m.mockStepResult(
          { name: "bereich-checkin-versuch-2" },
          { area: "checkin", status: "succeeded", storedCount: 5 }
        );
        // Falsches Passwort: nie wiederholen.
        await m.mockStepResult(
          { name: "bereich-graduierungen" },
          { area: "graduierungen", errorCode: "matool_login_failed", retryable: false, status: "failed" }
        );
        await m.mockStepResult({ name: "stilllegungen-offen-0" }, 0);
      });
      await workflow.create({ id: jobId, params: { jobId, requestedAt: new Date().toISOString() } });
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({ failed: 1, storedTotal: 9, succeeded: 5 });
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
        status: "partial_failed",
        failedAreas: ["graduierungen"]
      });
      const fehler = await env.DB.prepare(
        `SELECT area, error_code FROM matool_snapshot_runs
         WHERE status = 'failed' AND sync_id = (
           SELECT sync_id FROM matool_sync_runs ORDER BY started_at DESC LIMIT 1
         )`
      ).all<{ area: string; error_code: string }>();
      // Nur der endgueltig gescheiterte Bereich wird als Fehler vermerkt.
      expect(fehler.results).toEqual([{ area: "graduierungen", error_code: "matool_login_failed" }]);
    } finally {
      await instance.dispose();
    }
  });

  it("liest im Stundenlauf die Ex-Mitglieder nur, wenn ihr letzter Erfolg aelter als 20 Stunden ist", async () => {
    const { selectDueDirectAreas, MATOOL_DIRECT_SNAPSHOT_AREAS } = await import("../src/worker/schedule");
    await env.DB.prepare("DELETE FROM matool_snapshot_runs WHERE area = 'schueler_ex' AND run_id LIKE 'faellig_%'").run();
    const jetzt = new Date("2098-06-02T08:00:00.000Z");
    const alle = [...MATOOL_DIRECT_SNAPSHOT_AREAS];
    const ohneEx = alle.filter((area) => area !== "schueler_ex");
    const erfolg = (runId: string, finishedAt: string) =>
      env.DB.prepare(
        `INSERT INTO matool_snapshot_runs (run_id, area, status, started_at, finished_at,
           fetched_count, success_count, failure_count, error_code)
         VALUES (?, 'schueler_ex', 'succeeded', ?, ?, 1, 1, 0, NULL)`
      ).bind(runId, finishedAt, finishedAt).run();

    await erfolg("faellig_alt", "2098-06-01T07:00:00.000Z");
    await expect(selectDueDirectAreas(env.DB, "scheduled", jetzt)).resolves.toEqual(alle);
    await erfolg("faellig_neu", "2098-06-02T07:10:00.000Z");
    await expect(selectDueDirectAreas(env.DB, "scheduled", jetzt)).resolves.toEqual(ohneEx);
    // Der Knopf liest immer alles.
    await expect(selectDueDirectAreas(env.DB, "manual", jetzt)).resolves.toEqual(alle);
    await env.DB.prepare("DELETE FROM matool_snapshot_runs WHERE run_id LIKE 'faellig_%'").run();
  });

  it("startet den Stundenlauf je Stunde genau einmal", async () => {
    const { scheduledSyncInstanceId, startScheduledSyncWorkflow } = await import("../src/worker/schedule");
    const erstellt: string[] = [];
    const vorhanden = new Set<string>();
    const runtimeEnv = {
      ...env,
      DIRECT_SYNC_WORKFLOW: {
        create: async ({ id }: { id: string }) => {
          if (vorhanden.has(id)) {
            throw new Error("instance.already_exists");
          }
          vorhanden.add(id);
          erstellt.push(id);
          return { id };
        },
        get: async (id: string) => {
          if (!vorhanden.has(id)) {
            throw new Error("instance.not_found");
          }
          return { id };
        }
      }
    } as unknown as Env;
    const stunde = Date.parse("2098-06-03T09:00:00.000Z");
    await expect(startScheduledSyncWorkflow(runtimeEnv, stunde)).resolves.toEqual({
      instanceId: scheduledSyncInstanceId(stunde),
      started: true
    });
    await expect(startScheduledSyncWorkflow(runtimeEnv, stunde + 30_000)).resolves.toEqual({
      instanceId: scheduledSyncInstanceId(stunde),
      started: false
    });
    expect(erstellt).toHaveLength(1);
  });
});

describe("Stundenlauf bei belegter Sperre", () => {
  it("wartet auf eine freie Sperre und gibt sonst auf", async () => {
    await expect(waitForFreeDirectSyncLease(env.DB, 50, 10)).resolves.toBe(true);
    const lease = await acquireExactSyncLease(env.DB, `test_${crypto.randomUUID()}`);
    try {
      await expect(waitForFreeDirectSyncLease(env.DB, 50, 10)).resolves.toBe(false);
      const warten = waitForFreeDirectSyncLease(env.DB, 5_000, 20);
      await releaseExactSyncLease(env.DB, lease);
      await expect(warten).resolves.toBe(true);
    } finally {
      await releaseExactSyncLease(env.DB, lease).catch(() => false);
    }
  });
});

describe("Stilllegungen nachlesen", () => {
  it("zaehlt ungelesene Mitglieder und liest ein Paket in der gewuenschten Groesse", async () => {
    const { vi } = await import("vitest");
    const { MatoolClient } = await import("../src/matool/client");
    const { persistMatoolSnapshotRun } = await import("../src/worker/matool-store");
    const { storedPayloadCipher } = await import("../src/worker/payload-encryption");
    const { collectMatoolSnapshots, countUnreadStilllegungen, MATOOL_STILLLEGUNGEN_PER_MANUAL_RUN } =
      await import("../src/worker/schedule");

    await env.DB.prepare(
      "DELETE FROM matool_snapshots WHERE area IN ('schueler', 'schueler_stilllegungen')"
    ).run();
    const cipher = await storedPayloadCipher(env);
    const ids = Array.from({ length: 30 }, (_, i) => String(8800 + i));
    const persist = (area: string, sourceIds: string[], payload: Record<string, string>) =>
      persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields: Object.keys(payload),
        area,
        finishedAt: "2098-08-01T00:00:00.000Z",
        observedAt: "2098-08-01T00:00:00.000Z",
        records: sourceIds.map((sourceId) => ({ payload, sourceId })),
        runId: `fill_${area}_${crypto.randomUUID()}`,
        startedAt: "2098-08-01T00:00:00.000Z"
      }, cipher);
    await persist("schueler", ids, { status: "SYNTHETISCH" });
    await persist("schueler_stilllegungen", ids.slice(0, 5), { zeitraeume: "" });
    await expect(countUnreadStilllegungen(env.DB)).resolves.toBe(25);

    let angefragt: readonly string[] = [];
    const abruf = vi.spyOn(MatoolClient.prototype, "extractStilllegungen").mockImplementation(
      async (_credentials, sourceIds) => {
        angefragt = sourceIds;
        return { area: "schueler_stilllegungen", bodyBytes: 0, records: [], rowCount: 0 };
      }
    );
    const runtimeEnv = { ...env, MATOOL_EMAIL: "x@example.invalid", MATOOL_PASSWORD: "synthetic" } as Env;
    try {
      await collectMatoolSnapshots(runtimeEnv, Date.now(), ["schueler_stilllegungen"], "manual", {
        stilllegungenLimit: 20
      });
      // Ungelesene zuerst.
      expect(angefragt).toHaveLength(20);
      expect(angefragt.every((id) => !ids.slice(0, 5).includes(id))).toBe(true);

      await collectMatoolSnapshots(runtimeEnv, Date.now(), ["schueler_stilllegungen"], "manual");
      expect(angefragt).toHaveLength(MATOOL_STILLLEGUNGEN_PER_MANUAL_RUN);

      // Die Karte zeigt fuer diesen Lauf nur den geplanten Bereich.
      const { readMatoolSyncRunPlan } = await import("../src/worker/sync-store");
      const letzter = await env.DB.prepare(
        "SELECT sync_id FROM matool_sync_runs ORDER BY started_at DESC LIMIT 1"
      ).first<{ sync_id: string }>();
      await expect(readMatoolSyncRunPlan(env.DB, letzter!.sync_id)).resolves.toEqual([
        "schueler_stilllegungen"
      ]);
    } finally {
      abruf.mockRestore();
    }
  });

  it("liest im Workflow nach dem Abruf paketweise nach, bis nichts mehr offen ist", async () => {
    const { introspectWorkflowInstance } = await import("cloudflare:test");
    const workflow = (env as unknown as Env).DIRECT_SYNC_WORKFLOW!;
    const jobId = `manuell_fill_${Date.now()}`;
    await env.DB.prepare("DROP TABLE IF EXISTS matool_manual_sync_jobs").run();
    await createManualSyncJob(env.DB, jobId);
    const instance = await introspectWorkflowInstance(workflow, jobId);
    try {
      await instance.modify(async (m) => {
        await m.disableSleeps();
        await mockeBereiche(m, 100);
        await m.mockStepResult({ name: "stilllegungen-offen-0" }, 150);
        await m.mockStepResult({ name: "stilllegungen-nachlesen-0" }, { storedTotal: 100 });
        await m.mockStepResult({ name: "stilllegungen-offen-1" }, 50);
        await m.mockStepResult({ name: "stilllegungen-nachlesen-1" }, { storedTotal: 50 });
        await m.mockStepResult({ name: "stilllegungen-offen-2" }, 0);
      });
      await workflow.create({ id: jobId, params: { jobId, requestedAt: new Date().toISOString() } });
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({ failed: 0, storedTotal: 750, succeeded: 6 });
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({ status: "succeeded", storedTotal: 750 });
    } finally {
      await instance.dispose();
    }
  });

  it("behaelt den Abruf, wenn ein Paket auch nach Wiederholung scheitert", async () => {
    const { introspectWorkflowInstance } = await import("cloudflare:test");
    const workflow = (env as unknown as Env).DIRECT_SYNC_WORKFLOW!;
    const jobId = `manuell_fillfehler_${Date.now()}`;
    await env.DB.prepare("DROP TABLE IF EXISTS matool_manual_sync_jobs").run();
    await createManualSyncJob(env.DB, jobId);
    const instance = await introspectWorkflowInstance(workflow, jobId);
    try {
      await instance.modify(async (m) => {
        await m.disableSleeps();
        await m.disableRetryDelays();
        await mockeBereiche(m, 100);
        await m.mockStepResult({ name: "stilllegungen-offen-0" }, 150);
        await m.mockStepError({ name: "stilllegungen-nachlesen-0" }, new Error("matool_exact_sync_lease_store_failed"), 3);
      });
      await workflow.create({ id: jobId, params: { jobId, requestedAt: new Date().toISOString() } });
      await instance.waitForStatus("complete");
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
        status: "partial_failed",
        storedTotal: 600,
        failedAreas: ["schueler_stilllegungen"]
      });
    } finally {
      await instance.dispose();
    }
  });
});

describe("Lebenszeichen der Sperre", () => {
  it("uebersteht einen kurzen D1-Aussetzer, solange die Sperre noch gilt", async () => {
    const { renewLeaseHeartbeat } = await import("../src/worker/schedule");
    const kaputt = {
      prepare: () => {
        throw new Error("D1_ERROR: network connection lost");
      }
    } as unknown as D1Database;
    const jetzt = new Date("2098-09-01T10:00:00.000Z");
    const lease = { ownerId: "direct_test", fencingToken: 7, expiresAt: "2098-09-01T10:15:00.000Z" };
    await expect(renewLeaseHeartbeat(kaputt, lease, jetzt)).resolves.toBe(lease);
    const knapp = { ...lease, expiresAt: "2098-09-01T10:03:00.000Z" };
    await expect(renewLeaseHeartbeat(kaputt, knapp, jetzt)).rejects.toMatchObject({
      code: "matool_exact_sync_lease_store_failed"
    });
  });
});
