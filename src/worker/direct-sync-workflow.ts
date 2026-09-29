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
import {
  collectMatoolSnapshots,
  countUnreadStilllegungen,
  MATOOL_STILLLEGUNGEN_FILL_BATCH
} from "./schedule";

/** So lange wartet ein manueller Abruf hoechstens auf einen laufenden Abruf. */
export const MANUAL_SYNC_MAX_WAIT_MINUTES = 30;

/**
 * Hoechstzahl der Nachlese-Pakete fuer Stilllegungen (je
 * MATOOL_STILLLEGUNGEN_FILL_BATCH Mitglieder), also bis zu 800 Mitglieder.
 */
export const MANUAL_SYNC_FILL_MAX_BATCHES = 8;

interface Ergebnis {
  failed: number;
  failedAreas: string[];
  storedTotal: number;
  succeeded: number;
}

/**
 * Manueller Gesamtabruf als Workflow: unabhaengig vom Browser, ohne das
 * 15-Minuten-Limit eines Cron-Aufrufs.
 *
 * 1. Laeuft gerade ein anderer Abruf (Stundenlauf), wartet er minuetlich auf
 *    dessen Ende und liest dann alle Bereiche genau einmal -- ohne
 *    Wiederholung, damit MATOOL nicht doppelt gelesen wird.
 * 2. Danach liest er die Stilllegungen aller Mitglieder nach, fuer die sie
 *    noch nie gelesen wurden: in Paketen zu 100, jedes ein eigener Schritt,
 *    sofort gespeichert und bei einem Fehler zweimal wiederholt. Ein
 *    Aussetzer kostet so hoechstens ein Paket, nicht den ganzen Nachlauf.
 */
export class DirectSyncWorkflow extends WorkflowEntrypoint<Env, DirectSyncWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<DirectSyncWorkflowParams>>,
    step: WorkflowStep
  ): Promise<{ failed: number; storedTotal: number; succeeded: number }> {
    const { jobId, requestedAt } = event.payload;
    try {
      await this.warteAufSperre(step, jobId, "sperre");

      const ergebnis: Ergebnis = await step.do(
        "abruf",
        {
          retries: { limit: 0, delay: "1 second", backoff: "constant" },
          timeout: "45 minutes"
        },
        async () => {
          const zeitpunkt = Date.parse(requestedAt) || Date.now();
          try {
            await startOrResumeInteressentenSyncWorkflow(this.env, zeitpunkt, "manual");
          } catch {
            // Der Interessenten-Workflow hat seinen eigenen Status; er darf
            // den Mitgliederabruf nicht verhindern.
          }
          const summary = await collectMatoolSnapshots(this.env, zeitpunkt);
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

      for (let paket = 0; paket < MANUAL_SYNC_FILL_MAX_BATCHES; paket += 1) {
        const offen = await step.do(`stilllegungen-offen-${paket}`, async () =>
          countUnreadStilllegungen(this.env.DB)
        );
        if (offen === 0) {
          break;
        }
        try {
          await this.warteAufSperre(step, jobId, `nachlesen-${paket}`);
          const teil = await step.do(
            `stilllegungen-nachlesen-${paket}`,
            {
              retries: { limit: 2, delay: "1 minute", backoff: "constant" },
              timeout: "30 minutes"
            },
            async () => {
              const summary = await collectMatoolSnapshots(
                this.env,
                Date.now(),
                ["schueler_stilllegungen"],
                "manual",
                { stilllegungenLimit: MATOOL_STILLLEGUNGEN_FILL_BATCH }
              );
              if (summary.failed > 0) {
                // Ein Fehler loest die Wiederholung des Schritts aus.
                throw new AppError(
                  summary.areas.find((area) => area.errorCode)?.errorCode ??
                    "manual_sync_fill_failed",
                  503,
                  "Das Nachlesen der Stilllegungen ist fehlgeschlagen."
                );
              }
              return { storedTotal: summary.storedTotal };
            }
          );
          ergebnis.storedTotal += teil.storedTotal;
        } catch {
          // Auch nach zwei Wiederholungen fehlgeschlagen: Der Hauptabruf und
          // die schon gespeicherten Pakete bleiben, der Rest folgt stuendlich.
          ergebnis.failed += 1;
          if (!ergebnis.failedAreas.includes("schueler_stilllegungen")) {
            ergebnis.failedAreas.push("schueler_stilllegungen");
          }
          break;
        }
      }

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

  /** Wartet minuetlich, bis kein anderer Abruf mehr die Sperre haelt. */
  private async warteAufSperre(
    step: WorkflowStep,
    jobId: string,
    name: string
  ): Promise<void> {
    for (let minute = 0; ; minute += 1) {
      const belegt = await step.do(`${name}-pruefen-${minute}`, async () => {
        const held = await isDirectSyncLeaseHeld(this.env.DB);
        await markManualSyncJob(this.env.DB, jobId, held ? "waiting" : "running");
        return held;
      });
      if (!belegt) {
        return;
      }
      if (minute >= MANUAL_SYNC_MAX_WAIT_MINUTES) {
        throw new AppError(
          "manual_sync_lease_timeout",
          503,
          "Ein anderer Abruf lief laenger als 30 Minuten; der manuelle Abruf wurde nicht gestartet."
        );
      }
      await step.sleep(`${name}-warten-${minute}`, "1 minute");
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
