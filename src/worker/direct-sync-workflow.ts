import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { AppError, toAppError } from "../core/app-error";
import {
  createManualSyncJob,
  finishManualSyncJob,
  isDirectSyncLeaseHeld,
  markManualSyncJob,
  openManualSyncJob,
  type ManualSyncJob
} from "./direct-sync-store";
import type { DirectSyncWorkflowParams, Env } from "./env";
import { startOrResumeInteressentenSyncWorkflow } from "./interessenten-sync-workflow";
import { collectMatoolSnapshots } from "./schedule";

/** So lange wartet ein manueller Abruf hoechstens auf einen laufenden Abruf. */
export const MANUAL_SYNC_MAX_WAIT_MINUTES = 30;

/**
 * Manueller Gesamtabruf als Workflow: unabhaengig vom Browser, ohne das
 * 15-Minuten-Limit eines Cron-Aufrufs. Laeuft gerade ein anderer Abruf
 * (Stundenlauf), wartet er minuetlich auf dessen Ende und startet dann
 * genau einmal -- ohne Wiederholung, damit MATOOL nicht doppelt gelesen wird.
 */
export class DirectSyncWorkflow extends WorkflowEntrypoint<Env, DirectSyncWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<DirectSyncWorkflowParams>>,
    step: WorkflowStep
  ): Promise<{ failed: number; storedTotal: number; succeeded: number }> {
    const { jobId, requestedAt } = event.payload;
    try {
      for (let minute = 0; ; minute += 1) {
        const belegt = await step.do(`sperre-pruefen-${minute}`, async () => {
          const held = await isDirectSyncLeaseHeld(this.env.DB);
          await markManualSyncJob(this.env.DB, jobId, held ? "waiting" : "running");
          return held;
        });
        if (!belegt) {
          break;
        }
        if (minute >= MANUAL_SYNC_MAX_WAIT_MINUTES) {
          throw new AppError(
            "manual_sync_lease_timeout",
            503,
            "Ein anderer Abruf lief laenger als 30 Minuten; der manuelle Abruf wurde nicht gestartet."
          );
        }
        await step.sleep(`warten-${minute}`, "1 minute");
      }

      const ergebnis = await step.do(
        "abruf",
        {
          retries: { limit: 0, delay: "1 second", backoff: "constant" },
          timeout: "90 minutes"
        },
        async () => {
          const zeitpunkt = Date.parse(requestedAt) || Date.now();
          try {
            await startOrResumeInteressentenSyncWorkflow(this.env, zeitpunkt, "manual");
          } catch {
            // Der Interessenten-Workflow hat seinen eigenen Status; er darf
            // den Mitgliederabruf nicht verhindern.
          }
          const summary = await collectMatoolSnapshots(
            this.env,
            zeitpunkt,
            undefined,
            "manual",
            { fillUnreadStilllegungen: true }
          );
          return {
            failed: summary.failed,
            failedAreas: summary.areas
              .filter((area) => area.status === "failed")
              .map((area) => area.area),
            storedTotal: summary.storedTotal,
            succeeded: summary.succeeded
          };
        }
      );

      await step.do("ergebnis-speichern", async () => {
        await finishManualSyncJob(this.env.DB, jobId, ergebnis);
        return { gespeichert: true };
      });
      return {
        failed: ergebnis.failed,
        storedTotal: ergebnis.storedTotal,
        succeeded: ergebnis.succeeded
      };
    } catch (error) {
      const errorCode = toAppError(error).code;
      await step.do("fehler-speichern", async () => {
        await finishManualSyncJob(this.env.DB, jobId, {
          errorCode,
          failed: 0,
          failedAreas: [],
          storedTotal: 0,
          succeeded: 0
        });
        return { gespeichert: true };
      });
      throw new NonRetryableError(errorCode);
    }
  }
}

/**
 * Startet einen manuellen Abruf oder gibt den bereits offenen zurueck: Ein
 * Doppelklick startet keinen zweiten Lauf.
 */
export async function requestManualSync(
  env: Env,
  now: Date = new Date()
): Promise<{ job: ManualSyncJob; started: boolean }> {
  const workflow = env.DIRECT_SYNC_WORKFLOW;
  if (!workflow) {
    throw new AppError(
      "manual_sync_workflow_unavailable",
      503,
      "Der manuelle Abruf ist in dieser Umgebung nicht eingerichtet."
    );
  }
  const offen = await openManualSyncJob(env.DB, now);
  if (offen) {
    return { job: offen, started: false };
  }
  const jobId = `manuell_${now.getTime()}_${crypto.randomUUID().slice(0, 8)}`;
  const job = await createManualSyncJob(env.DB, jobId, now);
  try {
    await workflow.create({
      id: jobId,
      params: { jobId, requestedAt: now.toISOString() }
    });
  } catch {
    await finishManualSyncJob(env.DB, jobId, {
      errorCode: "manual_sync_workflow_unavailable",
      failed: 0,
      failedAreas: [],
      storedTotal: 0,
      succeeded: 0
    });
    throw new AppError(
      "manual_sync_workflow_unavailable",
      503,
      "Der manuelle Abruf konnte nicht gestartet werden. Bitte in einer Minute erneut versuchen."
    );
  }
  return { job, started: true };
}
