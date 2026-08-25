import { toAppError } from "../core/app-error";
import {
  MatoolClient,
  MATOOL_KLASSEN_PAYLOAD_FIELDS,
  type MatoolCredentials,
  type MatoolSafeAreaRecord
} from "../matool/client";
import type { Env } from "./env";
import {
  acquireExactSyncLease,
  assertExactSourceBaseline,
  persistFencedExactSnapshotRun,
  readMatchingExactSource,
  releaseExactSyncLease,
  renewExactSyncLease,
  type ExactSyncLease
} from "./exact-sync-safety";
import { startOrResumeInteressentenSyncWorkflow } from "./interessenten-sync-workflow";
import { recordMatoolSnapshotFailure } from "./matool-store";
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
// Fachlich benoetigt werden ausschliesslich Interessenten und Mitglieder,
// jeweils Liste vor Detailabruf. Die uebrigen MATOOL-Ansichten wurden am
// 24.08.2026 abgeschaltet und ihre Bestaende am 25.08.2026 geloescht.
export const MATOOL_SNAPSHOT_AREAS = [
  "interessenten",
  "interessenten_details",
  "schueler",
  "schueler_details"
] as const;

const MATOOL_DIRECT_SNAPSHOT_AREAS = MATOOL_SNAPSHOT_AREAS.filter(
  (area) =>
    area !== "interessenten" && area !== "interessenten_details"
);

// Nur Bereiche mit belegter vollstaendiger Pagination und stabiler
// Quellidentitaet duerfen den aktuellen D1-Bestand ersetzen. Weitere
// Bereiche werden erst nach ihrem eigenen exakten Collector freigeschaltet.
const EXACT_CURRENT_SET_AREAS = new Set([
  "archiv",
  "artikel",
  "klassen",
  "lager",
  "newsletter",
  "schueler"
]);

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

  const interessenten = await startOrResumeInteressentenSyncWorkflow(
    env,
    controller.scheduledTime,
    "scheduled"
  );
  console.info(
    JSON.stringify({
      event: "matool_interessenten_workflow_started_or_resumed",
      completedDetails: interessenten.completedDetails,
      detailCount: interessenten.detailCount,
      listCount: interessenten.listCount,
      missingDetails: interessenten.missingDetails,
      status: interessenten.status
    })
  );

  await collectMatoolSnapshots(
    env,
    controller.scheduledTime,
    MATOOL_DIRECT_SNAPSHOT_AREAS,
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
  areas: readonly string[] = MATOOL_DIRECT_SNAPSHOT_AREAS,
  trigger: MatoolSyncTrigger = "manual"
): Promise<CollectSnapshotsResult> {
  const directAreas = areas.filter(
    (area) =>
      area !== "interessenten" && area !== "interessenten_details"
  );
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

  const credentials = {
    email: env.MATOOL_EMAIL,
    password: env.MATOOL_PASSWORD
  } satisfies MatoolCredentials;
  const leaseOwner = `direct_${crypto.randomUUID()}`;
  let lease: ExactSyncLease | null = null;

  if (directAreas.length > 0) {
    try {
      lease = await acquireExactSyncLease(env.DB, leaseOwner);
    } catch (error) {
      const errorCode = toAppError(error).code;
      summary.failed = directAreas.length;
      summary.areas.push(
        ...directAreas.map((area) => ({
          area,
          errorCode,
          status: "failed" as const
        }))
      );
      console.error(
        JSON.stringify({
          errorCode,
          event: "matool_direct_sync_lease_not_acquired",
          scheduledTime: new Date(scheduledTime).toISOString(),
          syncId
        })
      );
    }
  }

  if (lease) {
    let activeLease = lease;
    // Nicht-exakte Bereiche teilen weiterhin eine Session. Die sechs
    // Current-Set-Bereiche erzeugen dagegen pro Kontrollabruf einen eigenen
    // Client und damit nachweislich zwei frische MATOOL-Sessions.
    const sharedClient = createDirectMatoolClient(env);
    try {
      for (const [areaIndex, area] of directAreas.entries()) {
        const runId = `snapshot_${area}_${crypto.randomUUID()}`;
        const areaStartedAt = new Date().toISOString();
        try {
          activeLease = await renewExactSyncLease(env.DB, activeLease);
          const records = EXACT_CURRENT_SET_AREAS.has(area)
            ? await readMatchingExactSource(
                () => exactAreaSession(env, credentials, area),
                async () => {
                  activeLease = await renewExactSyncLease(
                    env.DB,
                    activeLease
                  );
                }
              )
            : await readDirectArea(sharedClient, credentials, area);
          if (EXACT_CURRENT_SET_AREAS.has(area)) {
            await assertExactSourceBaseline(env.DB, area, records.length);
          }
          activeLease = await renewExactSyncLease(env.DB, activeLease);

          const finishedAt = new Date().toISOString();
          const result = await persistFencedExactSnapshotRun(
            env.DB,
            activeLease,
            {
              allowedPayloadFields:
                area === "klassen"
                  ? MATOOL_KLASSEN_PAYLOAD_FIELDS
                  : snapshotPayloadFields(records),
              area,
              finishedAt,
              observedAt: finishedAt,
              records,
              ...(EXACT_CURRENT_SET_AREAS.has(area)
                ? { replaceCurrentSet: true }
                : {}),
              runId,
              syncId,
              startedAt: areaStartedAt
            }
          );
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
              startedAt: areaStartedAt
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
          }
          console.error(
            JSON.stringify({
              area,
              errorCode,
              event: "matool_snapshot_failed",
              scheduledTime: new Date(scheduledTime).toISOString()
            })
          );

          try {
            activeLease = await renewExactSyncLease(env.DB, activeLease);
          } catch (leaseError) {
            const leaseErrorCode = toAppError(leaseError).code;
            const remainingAreas = directAreas.slice(areaIndex + 1);
            summary.failed += remainingAreas.length;
            summary.areas.push(
              ...remainingAreas.map((remainingArea) => ({
                area: remainingArea,
                errorCode: leaseErrorCode,
                status: "failed" as const
              }))
            );
            console.error(
              JSON.stringify({
                errorCode: leaseErrorCode,
                event: "matool_direct_sync_lease_lost",
                scheduledTime: new Date(scheduledTime).toISOString(),
                syncId
              })
            );
            break;
          }
        }
      }
    } finally {
      sharedClient.clearSession();
      try {
        await releaseExactSyncLease(env.DB, activeLease);
      } catch {
        // Die Lease bleibt begrenzt gueltig und ist danach automatisch
        // uebernehmbar; ein fremder Owner wird durch Token-Pruefung nie
        // geloescht.
        console.error(
          JSON.stringify({
            errorCode: "matool_exact_sync_lease_release_failed",
            event: "matool_direct_sync_lease_release_failed",
            syncId
          })
        );
      }
    }
  }

  await finishMatoolSyncRun(env.DB, syncId, new Date().toISOString(), {
    failed: summary.failed,
    storedTotal: summary.storedTotal,
    succeeded: summary.succeeded,
    totalAreas: directAreas.length
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

function createDirectMatoolClient(env: Env): MatoolClient {
  return new MatoolClient(env.MATOOL_BASE_URL, undefined, {
    maxRequestCount: MATOOL_MAX_REQUESTS_PER_RUN,
    minRequestIntervalMs: MATOOL_REQUEST_INTERVAL_MS
  });
}

function exactAreaSession(
  env: Env,
  credentials: MatoolCredentials,
  area: string
) {
  const client = createDirectMatoolClient(env);
  return {
    clear: () => client.clearSession(),
    read: () => readDirectArea(client, credentials, area)
  };
}

async function readDirectArea(
  client: MatoolClient,
  credentials: MatoolCredentials,
  area: string
): Promise<MatoolSafeAreaRecord[]> {
  return (
    area === "klassen"
      ? await client.extractKlassen(credentials, {
          maxRecords: MATOOL_KLASSEN_RECORDS_PER_RUN
        })
      : await client.extractSafeArea(credentials, area)
  ).records;
}
