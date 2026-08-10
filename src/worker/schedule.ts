import { toAppError } from "../core/app-error";
import {
  MatoolClient,
  MATOOL_KLASSEN_PAYLOAD_FIELDS
} from "../matool/client";
import type { Env } from "./env";
import {
  persistMatoolSnapshotRun,
  recordMatoolSnapshotFailure
} from "./matool-store";
import { processZapierOutbox } from "./outbox";
import { getProcessMode } from "./repository";
import { evaluateBerlinScheduleWindow } from "./schedule-window";
import {
  beginMatoolSyncRun,
  finishMatoolSyncRun,
  recordSkippedMatoolSync,
  type MatoolSyncTrigger
} from "./sync-store";

// Reihenfolge nach fachlichem Wert: Bricht ein Lauf an einer CPU- oder
// Subrequest-Grenze ab, sind die wichtigsten Bereiche bereits gespeichert.
export const MATOOL_SNAPSHOT_AREAS = [
  "klassen",
  "interessenten",
  "schueler",
  "checkin",
  "pruefungen",
  "artikel",
  "lager",
  "newsletter",
  "archiv",
  "telemetrie",
  "berichte",
  "karte"
] as const;

export interface CollectSnapshotsAreaResult {
  area: string;
  errorCode?: string;
  status: "succeeded" | "failed";
  storedCount?: number;
}

export interface CollectSnapshotsResult {
  areas: CollectSnapshotsAreaResult[];
  failed: number;
  storedTotal: number;
  succeeded: number;
}

const SNAPSHOT_PAYLOAD_FIELDS = [
  "tableIndex",
  "columnCount",
  "displayNumber",
  "createdDate",
  "firstName",
  "lastName",
  "status",
  ...Array.from({ length: 64 }, (_, index) =>
    `c${index.toString().padStart(2, "0")}`
  )
];

export async function handleScheduledInvocation(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  const scheduleWindow = evaluateBerlinScheduleWindow(
    controller.scheduledTime
  );
  if (!scheduleWindow.allowed) {
    console.info(
      JSON.stringify({
        event: "matool_snapshot_schedule_skipped",
        holiday: scheduleWindow.holiday,
        localDate: scheduleWindow.localDate,
        localHour: scheduleWindow.localHour,
        reason: scheduleWindow.reason,
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    await recordSkippedMatoolSync(env.DB, {
      reason: "outside_schedule_window",
      scheduledFor: new Date(controller.scheduledTime).toISOString()
    });
    return;
  }

  if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
    console.info(
      JSON.stringify({
        event: "matool_snapshot_schedule_skipped",
        reason: "matool_not_configured",
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    await recordSkippedMatoolSync(env.DB, {
      reason: "matool_not_configured",
      scheduledFor: new Date(controller.scheduledTime).toISOString()
    });
    return;
  }

  if (env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
    console.info(
      JSON.stringify({
        event: "matool_snapshot_schedule_skipped",
        reason: "real_matool_runs_not_confirmed",
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    await recordSkippedMatoolSync(env.DB, {
      reason: "real_runs_not_confirmed",
      scheduledFor: new Date(controller.scheduledTime).toISOString()
    });
    return;
  }

  await collectMatoolSnapshots(
    env,
    controller.scheduledTime,
    MATOOL_SNAPSHOT_AREAS,
    "scheduled"
  );

  const mode = await getProcessMode(env);
  if (
    mode === "active" &&
    env.OUTBOUND_DELIVERY_ENABLED === "true"
  ) {
    try {
      const outbox = await processZapierOutbox(env);
      console.info(
        JSON.stringify({
          event: "zapier_outbox_processed",
          accepted: outbox.accepted,
          awaitingClaims: outbox.awaitingClaims,
          permanentFailures: outbox.permanentFailures,
          processed: outbox.processed,
          retriesScheduled: outbox.retriesScheduled,
          scheduledTime: new Date(controller.scheduledTime).toISOString()
        })
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "zapier_outbox_failed",
          errorCode: "zapier_outbox_processing_failed",
          scheduledTime: new Date(controller.scheduledTime).toISOString()
        })
      );
    }
  }
}

export async function collectMatoolSnapshots(
  env: Env,
  scheduledTime: number,
  areas: readonly string[] = MATOOL_SNAPSHOT_AREAS,
  trigger: MatoolSyncTrigger = "manual"
): Promise<CollectSnapshotsResult> {
  const summary: CollectSnapshotsResult = {
    areas: [],
    failed: 0,
    storedTotal: 0,
    succeeded: 0
  };
  if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
    return summary;
  }

  const startedAt = new Date().toISOString();
  const syncId = await beginMatoolSyncRun(env.DB, {
    ...(trigger === "scheduled"
      ? { scheduledFor: new Date(scheduledTime).toISOString() }
      : {}),
    startedAt,
    trigger
  });

  // Ein Client für den gesamten Lauf: genau eine Anmeldung, eine Session.
  const client = new MatoolClient(env.MATOOL_BASE_URL);
  try {
    for (const area of areas) {
    const runId = `snapshot_${area}_${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    try {
      const credentials = {
        email: env.MATOOL_EMAIL,
        password: env.MATOOL_PASSWORD
      };
      // MATOOL rendert die Interessentenliste nicht als eine Tabelle,
      // sondern je Datensatz als eigene Tabellengruppe. Der strikte
      // Extraktor erwartet Kopf und Daten in derselben Tabelle und fand
      // deshalb null Zeilen. Der generische Extraktor kommt damit zurecht
      // und leitet die stabile ID aus dem Interessenten-Link ab.
      const records = (
        area === "klassen"
          ? await client.extractKlassen(credentials)
          : await client.extractSafeArea(credentials, area)
      ).records;
      const finishedAt = new Date().toISOString();
      const result = await persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields:
          area === "klassen"
            ? MATOOL_KLASSEN_PAYLOAD_FIELDS
            : SNAPSHOT_PAYLOAD_FIELDS,
        area,
        finishedAt,
        observedAt: finishedAt,
        records,
        runId,
        syncId,
        startedAt
      });
      summary.succeeded += 1;
      summary.storedTotal += result.storedCount;
      summary.areas.push({
        area,
        status: "succeeded",
        storedCount: result.storedCount
      });
      console.info(
        JSON.stringify({
          area,
          event: "matool_snapshot_succeeded",
          scheduledTime: new Date(scheduledTime).toISOString(),
          storedCount: result.storedCount
        })
      );
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const errorCode = toAppError(error).code;
      summary.failed += 1;
      summary.areas.push({ area, errorCode, status: "failed" });
      try {
        await recordMatoolSnapshotFailure(env.DB, {
          area,
          errorCode,
          finishedAt,
          runId,
          syncId,
          startedAt
        });
      } catch {
        console.error(
          JSON.stringify({
            area,
            errorCode: "matool_snapshot_failure_not_recorded",
            event: "matool_snapshot_failed",
            scheduledTime: new Date(scheduledTime).toISOString()
          })
        );
        continue;
      }
      console.error(
        JSON.stringify({
          area,
          errorCode,
          event: "matool_snapshot_failed",
          scheduledTime: new Date(scheduledTime).toISOString()
        })
      );
    }
    }
  } finally {
    client.clearSession();
  }

  await finishMatoolSyncRun(env.DB, syncId, new Date().toISOString(), {
    failed: summary.failed,
    storedTotal: summary.storedTotal,
    succeeded: summary.succeeded,
    totalAreas: areas.length
  });

  return summary;
}
