import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { AppError, toAppError } from "../core/app-error";
import { sichereBeitragsStichtagSafely } from "./beitrags-archiv";
import {
  createManualSyncJob,
  finishManualSyncJob,
  isDirectSyncLeaseHeld,
  markManualSyncJob,
  openManualSyncJob,
  type ManualSyncJob
} from "./direct-sync-store";
import type { DirectSyncWorkflowParams, Env } from "./env";
import { acquireExactSyncLease } from "./exact-sync-safety";
import { startOrResumeInteressentenSyncWorkflow } from "./interessenten-sync-workflow";
import { processZapierOutbox } from "./outbox";
import { getProcessMode } from "./repository";
import {
  addAreaResult,
  beginDirectSync,
  collectMatoolSnapshots,
  countUnreadStilllegungen,
  deliverSnapshotChanges,
  finishDirectSync,
  MATOOL_STILLLEGUNGEN_FILL_BATCH,
  recordDirectAreaFailure,
  releaseDirectSyncLease,
  selectDueDirectAreas,
  syncDirectArea,
  type CollectSnapshotsResult,
  type DirectSyncAreaResult
} from "./schedule";
import {
  finishMatoolSyncRun,
  recordSkippedMatoolSync,
  type MatoolSyncTrigger
} from "./sync-store";

/** So lange wartet ein manueller Abruf hoechstens auf einen laufenden Abruf. */
export const MANUAL_SYNC_MAX_WAIT_MINUTES = 30;

/**
 * So lange wartet ein Stundenlauf auf einen noch laufenden Abruf. Danach wird
 * er als uebersprungen vermerkt; der naechste Stundenlauf holt alles nach.
 */
export const SCHEDULED_SYNC_MAX_WAIT_MINUTES = 20;

/**
 * Hoechstzahl der Nachlese-Pakete fuer Stilllegungen (je
 * MATOOL_STILLLEGUNGEN_FILL_BATCH Mitglieder), also bis zu 800 Mitglieder.
 */
export const MANUAL_SYNC_FILL_MAX_BATCHES = 8;

/**
 * Versuche je Bereich. Wiederholt wird nur, was ein zweiter Versuch heilen
 * kann (Netz, Last, kurzer D1-Aussetzer, unvollstaendig ausgelieferte Seite);
 * ein falsches Passwort oder ein fehlender Schluessel nie.
 */
export const DIRECT_SYNC_AREA_ATTEMPTS = 3;
const AREA_RETRY_PAUSES = ["30 seconds", "2 minutes"] as const;

/**
 * Hoechstdauer der Abrufe je Mitglied in einem Workflow-Lauf. Anders als im
 * Cron-Aufruf gibt es kein 15-Minuten-Limit; die Budgets halten den Lauf
 * trotzdem deutlich unter einer Stunde, damit Stundenlaeufe sich nie
 * ueberholen. Was nicht mehr hineinpasst, kommt im naechsten Lauf zuerst dran.
 */
export const WORKFLOW_DETAIL_AREA_BUDGET_MS: Readonly<Record<string, number>> = {
  schueler_stilllegungen: 6 * 60_000,
  schueler_details: 6 * 60_000,
  graduierungen: 5 * 60_000,
  checkin_historie: 4 * 60_000
};

/** Paketgroessen im Workflow; das Zeitbudget kann frueher enden. */
const WORKFLOW_DETAIL_LIMITS: Readonly<Record<string, number>> = {
  schueler_stilllegungen: 120,
  schueler_details: 150,
  graduierungen: 200,
  checkin_historie: 150
};

/**
 * Ein Schritt je Bereich. Der Schritt selbst wirft nur bei einem Absturz der
 * Laufzeit (Deploy, Neustart); dann einmal wiederholen.
 */
const AREA_STEP_CONFIG = {
  retries: { limit: 1, delay: "30 seconds", backoff: "constant" },
  timeout: "25 minutes"
} as const;

const DELIVERY_STEP_CONFIG = {
  retries: { limit: 1, delay: "1 minute", backoff: "constant" },
  timeout: "15 minutes"
} as const;

const SMALL_STEP_CONFIG = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
  timeout: "2 minutes"
} as const;

interface Ergebnis {
  failed: number;
  failedAreas: string[];
  storedTotal: number;
  succeeded: number;
}

interface Plan {
  areas: string[];
  syncId: string;
}

/**
 * Gesamtabruf der Mitgliederbereiche als dauerhafter Workflow -- fuer den
 * Stundenlauf (Cron) und den Knopf im Dashboard.
 *
 * 1. Laeuft gerade ein anderer Abruf, wartet er minuetlich auf dessen Ende
 *    (Stundenlauf hoechstens 20, manuell 30 Minuten).
 * 2. Er uebernimmt die Sperre fuer den ganzen Lauf und liest jeden faelligen
 *    Bereich als eigenen Schritt. Scheitert ein Bereich an etwas
 *    Voruebergehendem, wird nur dieser Bereich nach einer Pause wiederholt.
 *    Ein Deploy oder Neustart setzt beim naechsten Bereich fort, statt den
 *    ganzen Lauf zu verlieren.
 * 3. Danach Abschluss, Zapier-Zustellung und Start des Interessentenabgleichs
 *    -- nacheinander, damit MATOOL nie zwei Abrufe gleichzeitig beantwortet.
 * 4. Manuell zusaetzlich: Stilllegungen aller Mitglieder nachlesen, fuer die
 *    sie noch nie gelesen wurden (in Paketen, jedes sofort gespeichert).
 */
export class DirectSyncWorkflow extends WorkflowEntrypoint<Env, DirectSyncWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<DirectSyncWorkflowParams>>,
    step: WorkflowStep
  ): Promise<{ failed: number; skipped?: boolean; storedTotal: number; succeeded: number }> {
    const { jobId, requestedAt } = event.payload;
    const trigger: MatoolSyncTrigger = event.payload.trigger ?? "manual";
    const manual = trigger === "manual";
    const leaseOwner = leaseOwnerFor(event.instanceId);
    const zeitpunkt = Date.parse(requestedAt) || Date.now();
    let plan: Plan | undefined;
    try {
      const frei = await this.warteAufSperre(step, {
        jobId,
        leaseOwner,
        maxMinutes: manual ? MANUAL_SYNC_MAX_WAIT_MINUTES : SCHEDULED_SYNC_MAX_WAIT_MINUTES,
        name: "sperre",
        trackJob: manual
      });
      if (!frei) {
        if (manual) {
          throw new AppError(
            "manual_sync_lease_timeout",
            503,
            "Ein anderer Abruf lief laenger als 30 Minuten; der manuelle Abruf wurde nicht gestartet."
          );
        }
        await step.do("uebersprungen", SMALL_STEP_CONFIG, async () => {
          await recordSkippedMatoolSync(this.env.DB, {
            reason: "previous_run_active",
            scheduledFor: new Date(zeitpunkt).toISOString()
          });
          return { vermerkt: true };
        });
        return { failed: 0, skipped: true, storedTotal: 0, succeeded: 0 };
      }

      plan = await step.do("plan", SMALL_STEP_CONFIG, async () => {
        // Sperre sofort fuer den ganzen Lauf uebernehmen: Kein anderer Abruf
        // kann sich mehr zwischen zwei Bereiche schieben.
        await acquireExactSyncLease(this.env.DB, leaseOwner);
        const areas = await selectDueDirectAreas(this.env.DB, trigger);
        const syncId = await beginDirectSync(this.env, {
          areas,
          leaseOwner,
          scheduledTime: zeitpunkt,
          trigger
        });
        return { areas, syncId };
      });
      const aktiverPlan = plan;

      const summary: CollectSnapshotsResult = {
        areas: [],
        failed: 0,
        storedTotal: 0,
        succeeded: 0
      };
      for (const area of aktiverPlan.areas) {
        addAreaResult(
          summary,
          await this.leseBereich(step, area, {
            jobId,
            leaseOwner,
            scheduledTime: zeitpunkt,
            syncId: aktiverPlan.syncId,
            trigger
          })
        );
      }

      await step.do("abschluss", SMALL_STEP_CONFIG, async () => {
        await releaseDirectSyncLease(this.env.DB, leaseOwner, aktiverPlan.syncId);
        try {
          await finishDirectSync(this.env, aktiverPlan.syncId, summary, aktiverPlan.areas.length, {
            deliver: false
          });
        } catch (error) {
          // Wiederholung nach verlorener Antwort: Der Lauf ist schon
          // abgeschlossen, das ist kein Fehler.
          if (!(await isSyncRunFinished(this.env.DB, aktiverPlan.syncId))) {
            throw error;
          }
        }
        return { abgeschlossen: true };
      });

      // Eigener Schritt mit laengerem Timeout: Viele Aenderungen bedeuten
      // viele Zustellungen. Scheitert nie am Lauf, der schon abgeschlossen ist.
      await step.do("zustellung", DELIVERY_STEP_CONFIG, async () => {
        await deliverSnapshotChanges(this.env, aktiverPlan.syncId);
        if (!manual) {
          await this.verarbeiteOutbox();
          // Am 1. und 15. den Beitragsstand mit den eben gelesenen Daten
          // sichern (der Cron hat ihn nur mit dem vorherigen Stand gesichert).
          await sichereBeitragsStichtagSafely(this.env, new Date(zeitpunkt));
        }
        return { zugestellt: true };
      });

      // Erst jetzt: Interessenten und Mitglieder lesen nacheinander, nie
      // gleichzeitig. Der Interessentenabgleich hat seinen eigenen Status.
      await step.do("interessenten", SMALL_STEP_CONFIG, async () => {
        try {
          const status = await startOrResumeInteressentenSyncWorkflow(
            this.env,
            zeitpunkt,
            trigger
          );
          return { status: status.status };
        } catch (error) {
          return { status: "failed", errorCode: toAppError(error).code };
        }
      });

      const ergebnis: Ergebnis = {
        failed: summary.failed,
        failedAreas: summary.areas
          .filter((area) => area.status === "failed")
          .map((area) => area.area),
        storedTotal: summary.storedTotal,
        succeeded: summary.succeeded
      };

      if (manual) {
        await this.stilllegungenNachlesen(step, jobId, leaseOwner, ergebnis);
        await step.do("ergebnis-speichern", SMALL_STEP_CONFIG, async () => {
          await finishManualSyncJob(this.env.DB, jobId, ergebnis);
          return { gespeichert: true };
        });
      }
      return {
        failed: ergebnis.failed,
        storedTotal: ergebnis.storedTotal,
        succeeded: ergebnis.succeeded
      };
    } catch (error) {
      const errorCode = errorCodeOf(error);
      const offenerPlan = plan;
      await step.do("fehler-speichern", SMALL_STEP_CONFIG, async () => {
        await releaseDirectSyncLease(this.env.DB, leaseOwner);
        if (offenerPlan) {
          try {
            await finishMatoolSyncRun(this.env.DB, offenerPlan.syncId, new Date().toISOString(), {
              failed: offenerPlan.areas.length,
              storedTotal: 0,
              succeeded: 0,
              totalAreas: offenerPlan.areas.length
            });
          } catch {
            // Bereits abgeschlossen; nichts zu tun.
          }
        }
        if (manual) {
          await finishManualSyncJob(this.env.DB, jobId, {
            errorCode,
            failed: 0,
            failedAreas: [],
            storedTotal: 0,
            succeeded: 0
          });
        }
        return { gespeichert: true };
      });
      throw new NonRetryableError(errorCode);
    }
  }

  /**
   * Liest einen Bereich mit bis zu drei Versuchen. Jeder Versuch ist ein
   * eigener Schritt: Ein erfolgreicher Versuch wird nach einem Neustart nicht
   * wiederholt, ein fehlgeschlagener nur, wenn es etwas bringen kann.
   */
  private async leseBereich(
    step: WorkflowStep,
    area: string,
    lauf: {
      jobId: string;
      leaseOwner: string;
      scheduledTime: number;
      syncId: string;
      trigger: MatoolSyncTrigger;
    }
  ): Promise<DirectSyncAreaResult> {
    let result: DirectSyncAreaResult = { area, errorCode: "internal_error", status: "failed" };
    for (let versuch = 1; versuch <= DIRECT_SYNC_AREA_ATTEMPTS; versuch += 1) {
      const name = versuch === 1 ? `bereich-${area}` : `bereich-${area}-versuch-${versuch}`;
      try {
        result = await step.do(name, AREA_STEP_CONFIG, async () => {
          if (lauf.trigger === "manual") {
            // Lebenszeichen: Ein Auftrag ohne Aktualisierung seit einer
            // Stunde gilt sonst als verwaist und gibt einen zweiten frei.
            try {
              await markManualSyncJob(this.env.DB, lauf.jobId, "running");
            } catch {
              // Nur Anzeige; der Abruf laeuft weiter.
            }
          }
          const budget = WORKFLOW_DETAIL_AREA_BUDGET_MS[area];
          const limit = WORKFLOW_DETAIL_LIMITS[area];
          return syncDirectArea(this.env, area, {
            ...(budget !== undefined ? { areaDeadline: Date.now() + budget } : {}),
            ...(limit !== undefined ? { detailLimit: limit } : {}),
            leaseOwner: lauf.leaseOwner,
            recordFailure: false,
            scheduledTime: lauf.scheduledTime,
            syncId: lauf.syncId,
            trigger: lauf.trigger
          });
        });
      } catch (error) {
        // Der Schritt selbst ist zweimal abgestuerzt: nicht weiter versuchen.
        result = { area, errorCode: errorCodeOf(error), retryable: false, status: "failed" };
      }
      if (result.status === "succeeded" || !result.retryable) {
        break;
      }
      const pause = AREA_RETRY_PAUSES[versuch - 1];
      if (versuch < DIRECT_SYNC_AREA_ATTEMPTS && pause) {
        await step.sleep(`bereich-${area}-pause-${versuch}`, pause);
      }
    }
    if (result.status === "failed") {
      const errorCode = result.errorCode ?? "internal_error";
      await step.do(`bereich-${area}-fehler`, SMALL_STEP_CONFIG, async () => {
        await recordDirectAreaFailure(this.env, {
          area,
          errorCode,
          scheduledTime: lauf.scheduledTime,
          syncId: lauf.syncId
        });
        return { vermerkt: true };
      });
    }
    return result;
  }

  /**
   * Manuell: Stilllegungen aller Mitglieder nachlesen, fuer die sie noch nie
   * gelesen wurden -- in Paketen zu 100, jedes ein eigener Schritt, sofort
   * gespeichert und bei einem Fehler zweimal wiederholt.
   */
  private async stilllegungenNachlesen(
    step: WorkflowStep,
    jobId: string,
    leaseOwner: string,
    ergebnis: Ergebnis
  ): Promise<void> {
    for (let paket = 0; paket < MANUAL_SYNC_FILL_MAX_BATCHES; paket += 1) {
      const offen = await step.do(`stilllegungen-offen-${paket}`, async () =>
        countUnreadStilllegungen(this.env.DB)
      );
      if (offen === 0) {
        break;
      }
      try {
        await this.warteAufSperre(step, {
          jobId,
          leaseOwner,
          maxMinutes: MANUAL_SYNC_MAX_WAIT_MINUTES,
          name: `nachlesen-${paket}`,
          trackJob: true
        });
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
  }

  /** Zapier-Outbox des Interessenten-Piloten, nur im aktiven Modus. */
  private async verarbeiteOutbox(): Promise<void> {
    if (this.env.OUTBOUND_DELIVERY_ENABLED !== "true") {
      return;
    }
    try {
      if ((await getProcessMode(this.env)) !== "active") {
        return;
      }
      const outbox = await processZapierOutbox(this.env);
      console.info(
        JSON.stringify({
          event: "zapier_outbox_processed",
          accepted: outbox.accepted,
          awaitingClaims: outbox.awaitingClaims,
          permanentFailures: outbox.permanentFailures,
          processed: outbox.processed,
          retriesScheduled: outbox.retriesScheduled
        })
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "zapier_outbox_failed",
          errorCode: "zapier_outbox_processing_failed"
        })
      );
    }
  }

  /**
   * Wartet minuetlich, bis kein anderer Abruf mehr die Sperre haelt. Die
   * eigene Sperre (Fortsetzen nach Neustart) zaehlt nicht. false nach
   * `maxMinutes` vergeblichen Minuten.
   */
  private async warteAufSperre(
    step: WorkflowStep,
    input: {
      jobId: string;
      leaseOwner: string;
      maxMinutes: number;
      name: string;
      trackJob: boolean;
    }
  ): Promise<boolean> {
    for (let minute = 0; ; minute += 1) {
      const belegt = await step.do(`${input.name}-pruefen-${minute}`, async () => {
        const held = await isDirectSyncLeaseHeld(this.env.DB, new Date(), input.leaseOwner);
        if (input.trackJob) {
          await markManualSyncJob(this.env.DB, input.jobId, held ? "waiting" : "running");
        }
        return held;
      });
      if (!belegt) {
        return true;
      }
      if (minute >= input.maxMinutes) {
        if (input.trackJob) {
          throw new AppError(
            "manual_sync_lease_timeout",
            503,
            "Ein anderer Abruf lief laenger als 30 Minuten; der manuelle Abruf wurde nicht gestartet."
          );
        }
        return false;
      }
      await step.sleep(`${input.name}-warten-${minute}`, "1 minute");
    }
  }
}

async function isSyncRunFinished(db: D1Database, syncId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT status FROM matool_sync_runs WHERE sync_id = ?")
    .bind(syncId)
    .first<{ status: string }>();
  return row !== null && row.status !== "running";
}

/** Besitzer der Sperre fuer eine Workflow-Instanz (stabil ueber Neustarts). */
export function leaseOwnerFor(instanceId: string): string {
  const cleaned = instanceId.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 100);
  return `wf_${cleaned || "lauf"}`;
}

/**
 * Fehlercode aus einem Fehler, auch wenn er die Workflow-Grenze passiert hat
 * (dann ist nur noch die Nachricht erhalten).
 */
export function errorCodeOf(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  if (error instanceof Error && /^[a-z][a-z0-9_]{2,80}$/u.test(error.message)) {
    return error.message;
  }
  return toAppError(error).code;
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
      params: { jobId, requestedAt: now.toISOString(), trigger: "manual" }
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
