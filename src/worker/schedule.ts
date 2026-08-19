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
import { processSnapshotZapierDeliveries } from "./snapshot-delivery";

// Interessenten und ihre Details haben fachlich Vorrang. Der Klassenabruf
// folgt danach, damit beide anfragestarken Bereiche in stabiler Reihenfolge
// vollstaendig verarbeitet werden.
export const MATOOL_SNAPSHOT_AREAS = [
  "interessenten",
  "interessenten_details",
  "klassen",
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

/**
 * Entspricht der maximalen Zahl von Interessenten, die der Extraktor aus
 * einer MATOOL-Liste annimmt. Im Paid-Betrieb wird damit der gesamte
 * erkannte Bestand in jedem Lauf aktualisiert.
 */
export const MATOOL_INTERESSENTEN_DETAILS_PER_RUN = 500;

/**
 * Entspricht der maximalen Zahl von Klassen, die der Extraktor aus der
 * MATOOL-Klassenliste annimmt. Der Paid-Lauf liest sie ohne Rotation.
 */
export const MATOOL_KLASSEN_RECORDS_PER_RUN = 500;

/**
 * Interne Obergrenze fuer den vollstaendigen Paid-Lauf. Sie deckt je bis zu
 * 500 Interessenten- und Klassendetails samt Login, Listen und Retry-Reserve
 * ab und bleibt deutlich unter Cloudflares Paid-Limit.
 */
export const MATOOL_MAX_REQUESTS_PER_RUN = 2_500;

/**
 * Mindestabstand zwischen zwei MATOOL-Anfragen. Ohne Pause beantwortet
 * MATOOL einen Lauf ab etwa dem vierten Bereich mit Verbindungsabbruechen.
 */
const MATOOL_REQUEST_INTERVAL_MS = 700;

interface InteressentenDetailCandidateRow {
  source_id: string;
}

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

// persistMatoolSnapshotRun akzeptiert hoechstens 80 Feldnamen. Die fruehere
// pauschale c00-c63-Liste verbrauchte den Grossteil dieses Budgets bereits,
// bevor die tatsaechlich von MATOOL gelieferten Spalten hinzukamen.
const MAX_SNAPSHOT_PAYLOAD_FIELDS = 80;
const SNAPSHOT_TECHNICAL_PAYLOAD_FIELDS = ["columnCount", "tableIndex"];
const SAFE_SNAPSHOT_PAYLOAD_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

/**
 * Erlaubte Feldnamen eines Laufs. Neben zwei technischen Basisfeldern werden
 * ausschliesslich die im aktuellen MATOOL-Abruf vorkommenden Feldnamen
 * zugelassen. Der Extraktor prueft deren Form bereits; hier wird die Auswahl
 * nochmals validiert und auf das Store-Limit begrenzt.
 */
export function snapshotPayloadFields(
  records: readonly { payload: Readonly<Record<string, unknown>> }[]
): string[] {
  const observedFields = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.payload)) {
      if (SAFE_SNAPSHOT_PAYLOAD_FIELD.test(key)) {
        observedFields.add(key);
      }
    }
  }

  // Technische Basis zuerst, danach alle real beobachteten Felder in stabiler
  // Reihenfolge. So ist die Auswahl unabhaengig von Datensatz- und
  // Objekt-Reihenfolge und bleibt garantiert innerhalb des Store-Limits.
  const orderedFields = [
    ...SNAPSHOT_TECHNICAL_PAYLOAD_FIELDS,
    ...[...observedFields].sort((left, right) => left.localeCompare(right))
  ];
  return [...new Set(orderedFields)].slice(0, MAX_SNAPSHOT_PAYLOAD_FIELDS);
}

/**
 * Waehlt den vollstaendigen erkannten Interessentenbestand in stabiler
 * Reihenfolge aus. Noch nicht angereicherte Interessenten kommen zuerst;
 * danach folgt der am laengsten nicht aktualisierte Detaildatensatz.
 */
export async function selectInteressentenDetailSourceIds(
  db: D1Database
): Promise<string[]> {
  const candidates = await db
    .prepare(
      `SELECT interessent.source_id
       FROM matool_snapshots AS interessent
       LEFT JOIN matool_snapshots AS details
         ON details.area = 'interessenten_details'
        AND details.source_id = interessent.source_id
       WHERE interessent.area = 'interessenten'
         AND length(interessent.source_id) BETWEEN 1 AND 32
         AND interessent.source_id NOT GLOB '*[^0-9]*'
       ORDER BY
         CASE WHEN details.source_id IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(details.last_seen_at, interessent.first_seen_at) ASC,
         interessent.source_id ASC
       LIMIT ?`
    )
    .bind(MATOOL_INTERESSENTEN_DETAILS_PER_RUN)
    .all<InteressentenDetailCandidateRow>();

  return candidates.results
    .map((row) => row.source_id)
    .filter((sourceId) => /^\d{1,32}$/u.test(sourceId));
}

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
  // Der Mindestabstand zwischen zwei Anfragen ist notwendig, weil MATOOL
  // schnelle Anfragefolgen ab dem vierten Bereich mit Verbindungsabbruechen
  // beantwortet. Wartezeit kostet Wall-Time, aber keine CPU-Zeit.
  const client = new MatoolClient(env.MATOOL_BASE_URL, undefined, {
    maxRequestCount: MATOOL_MAX_REQUESTS_PER_RUN,
    minRequestIntervalMs: MATOOL_REQUEST_INTERVAL_MS
  });
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
          ? await client.extractKlassen(credentials, {
              maxRecords: MATOOL_KLASSEN_RECORDS_PER_RUN
            })
          : area === "interessenten_details"
            ? await (async () => {
                const sourceIds = await selectInteressentenDetailSourceIds(
                  env.DB
                );
                return client.extractInteressentenDetails(
                  credentials,
                  MATOOL_INTERESSENTEN_DETAILS_PER_RUN,
                  sourceIds.length > 0 ? sourceIds : undefined
                );
              })()
            : await client.extractSafeArea(credentials, area)
      ).records;
      const finishedAt = new Date().toISOString();
      const result = await persistMatoolSnapshotRun(env.DB, {
        allowedPayloadFields:
          area === "klassen"
            ? MATOOL_KLASSEN_PAYLOAD_FIELDS
            : snapshotPayloadFields(records),
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

  if (env.OUTBOUND_DELIVERY_ENABLED === "true") {
    try {
      const delivery = await processSnapshotZapierDeliveries(env);
      console.info(
        JSON.stringify({
          event: "snapshot_zapier_delivery_processed",
          ...delivery,
          syncId
        })
      );
    } catch {
      console.error(
        JSON.stringify({
          errorCode: "snapshot_zapier_delivery_failed",
          event: "snapshot_zapier_delivery_failed",
          syncId
        })
      );
    }
  }

  return summary;
}
