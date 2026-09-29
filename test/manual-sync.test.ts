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

describe("DirectSyncWorkflow", () => {
  it("wartet auf die Sperre, laeuft einmal und speichert das Ergebnis", async () => {
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
        await m.mockStepResult(
          { name: "abruf" },
          { failed: 0, failedAreas: [], storedTotal: 7, succeeded: 6 }
        );
      });
      await workflow.create({ id: jobId, params: { jobId, requestedAt: new Date().toISOString() } });
      await expect(instance.waitForStepResult({ name: "sperre-pruefen-0" })).resolves.toBe(true);
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({ jobId, status: "waiting" });
      await releaseExactSyncLease(env.DB, lease);

      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({ failed: 0, storedTotal: 7, succeeded: 6 });
      await expect(latestManualSyncJob(env.DB)).resolves.toMatchObject({
        jobId,
        status: "succeeded",
        storedTotal: 7,
        succeeded: 6
      });
    } finally {
      await instance.dispose();
      await releaseExactSyncLease(env.DB, lease).catch(() => false);
    }
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
