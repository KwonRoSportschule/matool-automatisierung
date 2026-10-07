import { AppError, toAppError } from "../core/app-error";
import {
  MatoolClient,
  MatoolShapeMismatchError,
  MATOOL_KLASSEN_PAYLOAD_FIELDS,
  type MatoolCredentials,
  type MatoolSafeAreaRecord,
  type MatoolStopSignal
} from "../matool/client";
import { MATOOL_CHECKIN_HISTORIE_PAYLOAD_FIELDS } from "../matool/checkin-historie";
import { MATOOL_GRADUIERUNG_PAYLOAD_FIELDS } from "../matool/graduierung";
import { sichereBeitragsStichtagSafely } from "./beitrags-archiv";
import { runDataProtectionMaintenanceSafely } from "./data-protection";
import { runDatabaseMaintenanceSafely } from "./db-maintenance";
import { markRotationRead, selectRotatingSourceIds } from "./detail-rotation";
import { isDirectSyncLeaseHeld } from "./direct-sync-store";
import type { Env } from "./env";
import {
  acquireExactSyncLease,
  assertExactSourceBaseline,
  persistFencedExactSnapshotRun,
  readMatchingExactSource,
  renewExactSyncLease,
  type ExactSyncLease
} from "./exact-sync-safety";
import { startOrResumeInteressentenSyncWorkflow } from "./interessenten-sync-workflow";
import {
  recordMatoolResponseShape,
  recordMatoolSnapshotFailure
} from "./matool-store";
import { processZapierOutbox } from "./outbox";
import { storedPayloadCipher } from "./payload-encryption";
import { getProcessMode } from "./repository";
import { evaluateBerlinScheduleWindow } from "./schedule-window";
import {
  beginMatoolSyncRun,
  finishMatoolSyncRun,
  markAbandonedMatoolSyncRuns,
  recordMatoolSyncRunPlan,
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
//
// Erst alle Listen (sie muessen vollstaendig sein), danach die Abrufe je
// Mitglied. Diese rotieren und duerfen deshalb an einem Zeitbudget enden:
// zuerst Stilllegungen und Stammdaten (beide fuer die Beitragsuebersicht),
// danach die Graduierungen, zuletzt der Check-in-Verlauf (beide fuer die
// Pruefungslisten). Die Stilllegungen stehen vor den Stammdaten:
// Die Stammdaten sind laengst vollstaendig und werden nur aufgefrischt
// (neue Mitglieder kommen dort ohnehin zuerst dran).
export const MATOOL_SNAPSHOT_AREAS = [
  "interessenten",
  "interessenten_details",
  "schueler",
  "schueler_ex",
  "checkin",
  "schueler_stilllegungen",
  "schueler_details",
  "graduierungen",
  "checkin_historie"
] as const;

export const MATOOL_DIRECT_SNAPSHOT_AREAS = MATOOL_SNAPSHOT_AREAS.filter(
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
  "schueler",
  "schueler_ex"
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
 * Mitglieder-Stammdaten je Lauf. Jeder Datensatz kostet drei Abrufe --
 * oeffnen, lesen, schliessen -- und mit der Pause dazwischen rund zwei
 * Sekunden.
 *
 * Der Stundenlauf nimmt ein grosses Paket, liest davon aber nur so viel,
 * wie in sein Zeitbudget passt (MATOOL_DETAIL_AREA_BUDGET_MS); der Rest
 * kommt im naechsten Lauf zuerst dran. Der Knopf im
 * Dashboard haengt dagegen an einer offenen Web-Anfrage und wurde bei 100
 * Datensaetzen von Cloudflare abgebrochen; er bekommt ein kleines Paket,
 * damit er antwortet.
 *
 * Die Auswahl rotiert: zuerst die noch nicht angereicherten, danach die am
 * laengsten nicht aktualisierten.
 */
export const MATOOL_SCHUELER_DETAILS_PER_RUN = 150;
export const MATOOL_SCHUELER_DETAILS_PER_MANUAL_RUN = 25;

/**
 * Stilllegungen je Lauf (Obergrenze; das Zeitbudget kann frueher enden).
 * Auch sie kosten drei Abrufe je Mitglied (oeffnen, lesen, schliessen).
 */
export const MATOOL_STILLLEGUNGEN_PER_RUN = 60;
export const MATOOL_STILLLEGUNGEN_PER_MANUAL_RUN = 10;

/**
 * Der manuelle Abruf als Workflow liest die Stilllegungen aller Mitglieder,
 * fuer die sie noch nie gelesen wurden, in Paketen dieser Groesse nach (je
 * Paket ein eigener Lauf, sofort gespeichert; siehe direct-sync-workflow.ts).
 */
export const MATOOL_STILLLEGUNGEN_FILL_BATCH = 100;

/** Mitglieder der Liste, deren Stilllegungen noch nie gelesen wurden. */
export async function countUnreadStilllegungen(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS anzahl
       FROM matool_snapshots AS liste
       LEFT JOIN matool_snapshots AS stilllegung
         ON stilllegung.area = 'schueler_stilllegungen'
        AND stilllegung.source_id = liste.source_id
       WHERE liste.area = 'schueler'
         AND stilllegung.source_id IS NULL`
    )
    .first<{ anzahl: number }>();
  return Number(row?.anzahl ?? 0);
}

/**
 * Graduierungen je Lauf: ein Abruf je Mitglied. Sie rotieren ueber eine
 * eigene Tabelle (detail-rotation.ts), weil Mitglieder ohne Pruefung keinen
 * Datensatz haben.
 */
export const MATOOL_GRADUIERUNGEN_PER_RUN = 150;
export const MATOOL_GRADUIERUNGEN_PER_MANUAL_RUN = 25;

/**
 * Check-in-Verlauf je Lauf: ein Abruf je Mitglied, ein Datensatz je
 * Mitglied (auch ohne Check-in). Rotiert wie die Stammdaten ueber
 * last_seen_at; bei rund 560 Mitgliedern ist jedes etwa alle vier
 * Stundenlaeufe frisch.
 */
export const MATOOL_CHECKIN_HISTORIE_PER_RUN = 150;
export const MATOOL_CHECKIN_HISTORIE_PER_MANUAL_RUN = 25;

/**
 * Zeitbudget des Stundenlaufs. Cloudflare beendet einen Cron-Aufruf nach
 * 15 Minuten Wandzeit ohne Vorwarnung -- mitten in einem Bereich, ohne
 * Abschluss des Laufs und ohne die Bereiche danach. Die Abrufe zu MATOOL
 * enden deshalb nach 12 Minuten (ab Aufrufbeginn); der Rest bleibt fuer
 * Speichern, Zapier-Zustellung und den Beitragsstichtag.
 */
export const MATOOL_SCHEDULED_RUN_BUDGET_MS = 12 * 60_000;

/**
 * Hoechstdauer der Abrufe je Mitglied im Stundenlauf. Was nicht mehr
 * hineinpasst, kommt im naechsten Lauf zuerst dran.
 */
export const MATOOL_DETAIL_AREA_BUDGET_MS: Readonly<Record<string, number>> = {
  schueler_stilllegungen: 4 * 60_000,
  schueler_details: 3 * 60_000,
  graduierungen: 3 * 60_000,
  // Der Cron-Weg ist nur Rueckfall; im Workflow gelten eigene Budgets.
  checkin_historie: 90_000
};

/** Mindestzeit, die jedem spaeteren Bereich je Mitglied bleibt. */
const MATOOL_DETAIL_AREA_MIN_SHARE_MS = 90_000;

/** Mit weniger Restzeit wird ein Bereich nicht mehr begonnen. */
const MATOOL_AREA_MIN_REMAINING_MS = 45_000;

/**
 * Haelt beim Stundenlauf noch ein anderer Abruf die Sperre (meist ein
 * manueller), wartet er so lange darauf und wird sonst als uebersprungen
 * vermerkt -- statt alle Bereiche als fehlgeschlagen zu melden.
 */
const MATOOL_SCHEDULED_LEASE_WAIT_MS = 3 * 60_000;
const MATOOL_SCHEDULED_LEASE_POLL_MS = 20_000;

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
const SAFE_SNAPSHOT_PAYLOAD_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

// Zum Wochenbeginn darf die bestaetigte Check-in-Ansicht noch leer sein.
// Ihr festes Schema gilt auch dann; aus null Records laesst sich keine
// Feldallowlist ableiten. Die strenge Store-Validierung bleibt bestehen.
const MATOOL_CHECKIN_PAYLOAD_FIELDS = [
  "checkin_datum",
  "checkin_uhrzeit",
  "checkin_zeitpunkt",
  "klasse_id",
  "mitglied_id"
] as const;

/**
 * Erlaubte Feldnamen eines Laufs: ausschliesslich die im aktuellen
 * MATOOL-Abruf vorkommenden Feldnamen. Der Extraktor prueft deren Form
 * bereits; hier wird die Auswahl nochmals validiert und auf das Store-Limit
 * begrenzt.
 *
 * Bis zum 10.09.2026 standen hier zusaetzlich die Darstellungsfelder
 * "columnCount" und "tableIndex". Sie beschreiben nur, an welcher Stelle der
 * gerenderten Seite eine Zeile stand, und liessen deshalb jeden Listenlauf
 * den kompletten Bestand als geaendert melden.
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

  // Alle real beobachteten Felder in stabiler Reihenfolge. So ist die Auswahl
  // unabhaengig von Datensatz- und Objekt-Reihenfolge und bleibt garantiert
  // innerhalb des Store-Limits.
  const orderedFields = [...observedFields].sort((left, right) =>
    left.localeCompare(right)
  );
  return orderedFields.slice(0, MAX_SNAPSHOT_PAYLOAD_FIELDS);
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

/**
 * Waehlt die Mitglieder aus, deren Stammdaten als naechstes gelesen werden.
 * Noch nicht angereicherte zuerst, danach der am laengsten nicht
 * aktualisierte Detaildatensatz.
 */
export async function selectSchuelerDetailSourceIds(
  db: D1Database,
  limit: number = MATOOL_SCHUELER_DETAILS_PER_RUN,
  detailArea:
    | "checkin_historie"
    | "schueler_details"
    | "schueler_stilllegungen" = "schueler_details"
): Promise<string[]> {
  const candidates = await db
    .prepare(
      `SELECT liste.source_id
       FROM matool_snapshots AS liste
       LEFT JOIN matool_snapshots AS details
         ON details.area = ?
        AND details.source_id = liste.source_id
       WHERE liste.area = 'schueler'
         AND length(liste.source_id) BETWEEN 1 AND 32
         AND liste.source_id NOT GLOB '*[^0-9]*'
       ORDER BY
         CASE WHEN details.source_id IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(details.last_seen_at, liste.first_seen_at) ASC,
         liste.source_id ASC
       LIMIT ?`
    )
    .bind(detailArea, limit)
    .all<InteressentenDetailCandidateRow>();

  return candidates.results
    .map((row) => row.source_id)
    .filter((sourceId) => /^\d{1,32}$/u.test(sourceId));
}

/** Paketgroesse eines Detailbereichs fuer den Stunden- bzw. Handlauf. */
function detailLimitFor(area: string, trigger: MatoolSyncTrigger): number {
  if (area === "schueler_stilllegungen") {
    return trigger === "scheduled"
      ? MATOOL_STILLLEGUNGEN_PER_RUN
      : MATOOL_STILLLEGUNGEN_PER_MANUAL_RUN;
  }
  if (area === "graduierungen") {
    return trigger === "scheduled"
      ? MATOOL_GRADUIERUNGEN_PER_RUN
      : MATOOL_GRADUIERUNGEN_PER_MANUAL_RUN;
  }
  if (area === "checkin_historie") {
    return trigger === "scheduled"
      ? MATOOL_CHECKIN_HISTORIE_PER_RUN
      : MATOOL_CHECKIN_HISTORIE_PER_MANUAL_RUN;
  }
  return trigger === "scheduled"
    ? MATOOL_SCHUELER_DETAILS_PER_RUN
    : MATOOL_SCHUELER_DETAILS_PER_MANUAL_RUN;
}

/**
 * Wann ein Bereich je Mitglied aufhoeren soll: nach seinem eigenen Budget,
 * spaetestens aber so, dass jedem spaeteren Bereich je Mitglied noch seine
 * Mindestzeit bis zum Laufende bleibt. Ohne Laufende (Handlauf) kein Limit.
 */
export function detailAreaDeadline(
  area: string,
  laterAreas: readonly string[],
  runDeadline: number | undefined,
  now: number
): number | undefined {
  const budget = MATOOL_DETAIL_AREA_BUDGET_MS[area];
  if (runDeadline === undefined || budget === undefined) {
    return runDeadline;
  }
  const spaetere = laterAreas.filter(
    (later) => MATOOL_DETAIL_AREA_BUDGET_MS[later] !== undefined
  ).length;
  return Math.min(
    now + budget,
    runDeadline - spaetere * MATOOL_DETAIL_AREA_MIN_SHARE_MS
  );
}

/**
 * Taeglicher Tagesabschluss (UTC; 22:30 bzw. 23:30 Uhr in Berlin, also noch
 * am selben Kalendertag). Er ruft MATOOL nicht ab. Am 1. und 15. sichert er
 * den Stand der Beitragsuebersicht, damit auch ein Stichtag am Wochenende
 * oder Feiertag gesichert wird; an allen anderen Tagen tut er nichts.
 */
export const BEITRAGS_TAGESABSCHLUSS_CRON = "30 21 * * *";

export async function handleScheduledInvocation(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  // Das 15-Minuten-Limit zaehlt ab Aufrufbeginn, also auch die Wartung.
  const deadline = Date.now() + MATOOL_SCHEDULED_RUN_BUDGET_MS;
  // Indizes, Fristen technischer Hilfsdaten, Verschluesselung und
  // Loeschfristen laufen bei jedem Aufruf, auch ausserhalb des
  // MATOOL-Zeitfensters -- ohne manuell angewendete Migration.
  await runDatabaseMaintenanceSafely(env);
  await runDataProtectionMaintenanceSafely(env);

  // Der Tag richtet sich nach dem geplanten Zeitpunkt, nicht nach dem Ende
  // eines langen Laufs: So bleibt ein Lauf kurz vor Mitternacht seinem Tag
  // zugeordnet.
  const geplant = new Date(controller.scheduledTime);
  if (controller.cron === BEITRAGS_TAGESABSCHLUSS_CRON) {
    await sichereBeitragsStichtagSafely(env, geplant);
    return;
  }

  try {
    await runScheduledSync(controller, env, deadline);
  } finally {
    // Nach jedem Abruf (oder ausgelassenen Abruf) am 1. und 15. den Stand
    // der Beitragsuebersicht nachziehen; scheitert nie am Cron-Lauf.
    await sichereBeitragsStichtagSafely(env, geplant);
  }
}

async function runScheduledSync(
  controller: ScheduledController,
  env: Env,
  deadline: number
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

  // Regelbetrieb: Der Cron startet nur den dauerhaften Workflow und ist nach
  // Sekunden fertig. Der Workflow liest jeden Bereich als eigenen,
  // wiederholbaren Schritt -- ohne das 15-Minuten-Limit eines Cron-Aufrufs
  // und ohne dass ein Neustart oder Deploy den ganzen Lauf verliert.
  if (env.DIRECT_SYNC_WORKFLOW) {
    const started = await startScheduledSyncWorkflow(env, controller.scheduledTime);
    console.info(
      JSON.stringify({
        event: "matool_sync_workflow_started",
        instanceId: started.instanceId,
        started: started.started,
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    return;
  }

  if (!(await waitForFreeDirectSyncLease(env.DB))) {
    console.info(
      JSON.stringify({
        event: "matool_snapshot_schedule_skipped",
        reason: "lease_busy",
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    await recordSkippedMatoolSync(env.DB, {
      reason: "lease_busy",
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
    "scheduled",
    { deadline }
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

/**
 * Workflow-Instanz fuer eine geplante Stunde. Feuert der Cron fuer dieselbe
 * Stunde doppelt, entsteht kein zweiter Lauf.
 */
export function scheduledSyncInstanceId(scheduledTime: number): string {
  return `stunde_${Math.floor(scheduledTime / 3_600_000)}`;
}

export async function startScheduledSyncWorkflow(
  env: Env,
  scheduledTime: number
): Promise<{ instanceId: string; started: boolean }> {
  const instanceId = scheduledSyncInstanceId(scheduledTime);
  const workflow = env.DIRECT_SYNC_WORKFLOW;
  if (!workflow) {
    throw new AppError(
      "sync_workflow_unavailable",
      503,
      "Der Abruf-Workflow ist in dieser Umgebung nicht eingerichtet."
    );
  }
  try {
    await workflow.create({
      id: instanceId,
      params: {
        jobId: instanceId,
        requestedAt: new Date(scheduledTime).toISOString(),
        trigger: "scheduled"
      }
    });
    return { instanceId, started: true };
  } catch {
    // Bereits vorhanden (doppelter Cron) oder kurz nicht erreichbar: Ein
    // zweiter Versuch unterscheidet beides; ein vorhandener Lauf bleibt.
    try {
      await workflow.get(instanceId);
      return { instanceId, started: false };
    } catch {
      await recordSkippedMatoolSync(env.DB, {
        reason: "workflow_unavailable",
        scheduledFor: new Date(scheduledTime).toISOString()
      });
      return { instanceId, started: false };
    }
  }
}

/**
 * Ehemalige Mitglieder aendern sich selten, ihre Liste ist aber mit Abstand
 * die groesste (rund 67 Seiten, zur Sicherheit zweimal gelesen). Sie wird
 * deshalb nur gelesen, wenn der letzte Erfolg laenger als diese Frist
 * zurueckliegt -- im Werktagsbetrieb also einmal morgens -- und bei jedem
 * manuellen Abruf.
 */
export const MATOOL_SLOW_AREA_MAX_AGE_MS = 20 * 60 * 60 * 1_000;
const MATOOL_SLOW_AREAS = new Set(["schueler_ex"]);

/** Bereiche, die dieser Lauf lesen soll, in fester Reihenfolge. */
export async function selectDueDirectAreas(
  db: D1Database,
  trigger: MatoolSyncTrigger,
  now: Date = new Date()
): Promise<string[]> {
  const due: string[] = [];
  for (const area of MATOOL_DIRECT_SNAPSHOT_AREAS) {
    if (trigger === "scheduled" && MATOOL_SLOW_AREAS.has(area)) {
      const letzterErfolg = await lastSuccessfulAreaRun(db, area);
      if (
        letzterErfolg !== null &&
        now.getTime() - letzterErfolg < MATOOL_SLOW_AREA_MAX_AGE_MS
      ) {
        continue;
      }
    }
    due.push(area);
  }
  return due;
}

async function lastSuccessfulAreaRun(
  db: D1Database,
  area: string
): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT MAX(finished_at) AS finished_at
         FROM matool_snapshot_runs
         WHERE area = ? AND status = 'succeeded'`
      )
      .bind(area)
      .first<{ finished_at: string | null }>();
    const parsed = row?.finished_at ? Date.parse(row.finished_at) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Im Zweifel lesen: Lieber einmal zu viel als eine veraltete Liste.
    return null;
  }
}

/**
 * Wartet, bis kein anderer Abruf mehr die Sperre haelt. false, wenn sie nach
 * `maxWaitMs` noch belegt ist.
 */
export async function waitForFreeDirectSyncLease(
  db: D1Database,
  maxWaitMs: number = MATOOL_SCHEDULED_LEASE_WAIT_MS,
  pollMs: number = MATOOL_SCHEDULED_LEASE_POLL_MS
): Promise<boolean> {
  const warteBis = Date.now() + maxWaitMs;
  while (await isDirectSyncLeaseHeld(db)) {
    if (Date.now() >= warteBis) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}

/**
 * Lebenszeichen waehrend eines Bereichs. Ein kurzer D1-Aussetzer beim
 * Verlaengern (matool_exact_sync_lease_store_failed) bricht den Bereich nicht
 * ab, solange die Sperre noch mindestens fuenf Minuten gilt -- sonst waere
 * alles bis dahin Gelesene verloren. Eine verlorene Sperre bleibt ein Fehler;
 * vor dem Speichern prueft der Fencing-Guard ohnehin nochmals.
 */
export async function renewLeaseHeartbeat(
  db: D1Database,
  lease: ExactSyncLease,
  now: Date = new Date()
): Promise<ExactSyncLease> {
  try {
    return await renewExactSyncLease(db, lease, now);
  } catch (error) {
    const code = toAppError(error).code;
    const rest = Date.parse(lease.expiresAt) - now.getTime();
    if (code === "matool_exact_sync_lease_store_failed" && rest > 5 * 60_000) {
      console.warn(
        JSON.stringify({ event: "matool_lease_heartbeat_skipped", errorCode: code })
      );
      return lease;
    }
    throw error;
  }
}

export async function collectMatoolSnapshots(
  env: Env,
  scheduledTime: number,
  areas: readonly string[] = MATOOL_DIRECT_SNAPSHOT_AREAS,
  trigger: MatoolSyncTrigger = "manual",
  options: {
    /**
     * Zeitpunkt (ms), bis zu dem MATOOL abgefragt wird. Danach beginnt kein
     * Bereich mehr, und Abrufe je Mitglied enden mit dem bis dahin Gelesenen.
     */
    deadline?: number;
    /** Abweichende Paketgroesse fuer die Stilllegungen (Nachlesen). */
    stilllegungenLimit?: number;
  } = {}
): Promise<CollectSnapshotsResult> {
  const { deadline, stilllegungenLimit } = options;
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
  // Vor dem Laufbeginn: Ein ungueltiger Schluessel darf keinen haengenden
  // Lauf hinterlassen.
  await storedPayloadCipher(env);

  const syncId = await beginDirectSync(env, {
    areas: directAreas,
    scheduledTime,
    trigger
  });
  // Ein Besitzer fuer den ganzen Lauf: Jeder Bereich uebernimmt die Sperre
  // erneut (neuer Fencing-Token), gibt sie aber erst am Ende frei.
  const leaseOwner = `direct_${crypto.randomUUID()}`;
  try {
    for (const [areaIndex, area] of directAreas.entries()) {
      const result = await syncDirectArea(env, area, {
        areaDeadline: detailAreaDeadline(
          area,
          directAreas.slice(areaIndex + 1),
          deadline,
          Date.now()
        ),
        leaseOwner,
        ...(deadline !== undefined ? { runDeadline: deadline } : {}),
        scheduledTime,
        ...(area === "schueler_stilllegungen" && stilllegungenLimit !== undefined
          ? { detailLimit: stilllegungenLimit }
          : {}),
        syncId,
        trigger
      });
      addAreaResult(summary, result);
      if (result.status === "failed" && isLeaseLossCode(result.errorCode)) {
        // Ein anderer Lauf hat die Sperre uebernommen: Weitere Bereiche
        // wuerden nur dieselbe Meldung erzeugen.
        for (const remaining of directAreas.slice(areaIndex + 1)) {
          addAreaResult(summary, {
            area: remaining,
            ...(result.errorCode ? { errorCode: result.errorCode } : {}),
            status: "failed"
          });
        }
        break;
      }
    }
  } finally {
    await releaseDirectSyncLease(env.DB, leaseOwner, syncId);
  }

  await finishDirectSync(env, syncId, summary, directAreas.length);
  return summary;
}

/** Zaehlt ein Bereichsergebnis in die Laufzusammenfassung ein. */
export function addAreaResult(
  summary: CollectSnapshotsResult,
  result: CollectSnapshotsAreaResult
): void {
  if (result.status === "succeeded") {
    summary.succeeded += 1;
    summary.storedTotal += result.storedCount ?? 0;
  } else {
    summary.failed += 1;
  }
  summary.areas.push(
    result.status === "succeeded"
      ? {
          area: result.area,
          status: "succeeded",
          ...(result.storedCount !== undefined
            ? { storedCount: result.storedCount }
            : {})
        }
      : {
          area: result.area,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          status: "failed"
        }
  );
}

function isLeaseLossCode(code: string | undefined): boolean {
  return (
    code === "matool_exact_sync_busy" ||
    code === "matool_exact_sync_lease_lost"
  );
}

/**
 * Legt den Gesamtlauf an (Dashboard: "laeuft") und merkt sich die geplanten
 * Bereiche. Ein von Cloudflare beendeter frueherer Lauf wird dabei als
 * abgebrochen abgeschlossen, solange niemand die Sperre haelt.
 */
export async function beginDirectSync(
  env: Env,
  input: {
    areas: readonly string[];
    scheduledTime: number;
    trigger: MatoolSyncTrigger;
    /** Eigener Besitzer der Sperre (Workflow): zaehlt nicht als fremder Lauf. */
    leaseOwner?: string;
  }
): Promise<string> {
  const startedAt = new Date().toISOString();
  if (!(await isDirectSyncLeaseHeld(env.DB, new Date(), input.leaseOwner))) {
    await markAbandonedMatoolSyncRuns(env.DB, startedAt);
  }
  const syncId = await beginMatoolSyncRun(env.DB, {
    ...(input.trigger === "scheduled"
      ? { scheduledFor: new Date(input.scheduledTime).toISOString() }
      : {}),
    startedAt,
    trigger: input.trigger
  });
  // Welche Bereiche dieser Lauf liest -- fuer die Fortschrittskarte.
  await recordMatoolSyncRunPlan(env.DB, syncId, input.areas);
  return syncId;
}

/**
 * Schliesst den Gesamtlauf ab und stellt neue Aenderungen an Zapier zu.
 * Scheitert nie an der Zustellung.
 */
export async function finishDirectSync(
  env: Env,
  syncId: string,
  summary: CollectSnapshotsResult,
  totalAreas: number,
  options: { deliver?: boolean } = {}
): Promise<void> {
  await finishMatoolSyncRun(env.DB, syncId, new Date().toISOString(), {
    failed: summary.failed,
    storedTotal: summary.storedTotal,
    succeeded: summary.succeeded,
    totalAreas
  });
  if (options.deliver !== false) {
    await deliverSnapshotChanges(env, syncId);
  }
}

/** Stellt neue Aenderungen an abonnierte Zaps zu; scheitert nie. */
export async function deliverSnapshotChanges(
  env: Env,
  syncId: string
): Promise<void> {
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
}

/** Gibt die Sperre frei, sofern sie noch diesem Besitzer gehoert. */
export async function releaseDirectSyncLease(
  db: D1Database,
  leaseOwner: string,
  syncId?: string
): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM matool_exact_sync_leases
         WHERE lease_name = 'direct_snapshots' AND owner_id = ?`
      )
      .bind(leaseOwner)
      .run();
  } catch {
    // Die Lease bleibt begrenzt gueltig und ist danach automatisch
    // uebernehmbar; ein fremder Owner wird nie geloescht.
    console.error(
      JSON.stringify({
        errorCode: "matool_exact_sync_lease_release_failed",
        event: "matool_direct_sync_lease_release_failed",
        ...(syncId ? { syncId } : {})
      })
    );
  }
}

export interface DirectSyncAreaOptions {
  /** Ende der Abrufe je Mitglied (ms); danach endet der Bereich mit dem Gelesenen. */
  areaDeadline?: number | undefined;
  /** Abweichende Paketgroesse eines Detailbereichs. */
  detailLimit?: number;
  /**
   * Besitzer der Sperre. Mehrere Bereiche desselben Laufs verwenden denselben
   * Besitzer; jede Uebernahme erhoeht den Fencing-Token, sodass ein haengender
   * frueherer Versuch nichts mehr speichern kann.
   */
  leaseOwner: string;
  /** Fehler sofort als Bereichslauf vermerken (Standard). Der Workflow vermerkt erst nach allen Versuchen. */
  recordFailure?: boolean;
  /** Mit weniger Restzeit wird der Bereich nicht begonnen. */
  runDeadline?: number;
  scheduledTime: number;
  syncId: string;
  trigger: MatoolSyncTrigger;
}

export interface DirectSyncAreaResult extends CollectSnapshotsAreaResult {
  /** Ein weiterer Versuch kann helfen (Netz, Last, kurzer D1-Aussetzer). */
  retryable?: boolean;
}

/**
 * Fehlercodes, bei denen ein spaeterer zweiter Versuch sinnvoll ist. Alles
 * andere (falsches Passwort, fehlender Schluessel, unplausibel kleine Liste)
 * wird nicht wiederholt -- ein falsches Passwort darf das Konto nicht sperren.
 */
const RETRYABLE_AREA_ERROR_CODES = new Set([
  "internal_error",
  "matool_authentication_unverified",
  "matool_exact_source_mismatch",
  "matool_exact_sync_busy",
  "matool_exact_sync_lease_lost",
  "matool_exact_sync_lease_store_failed",
  "matool_network_error",
  "matool_schueler_open_failed",
  "matool_session_prime_failed",
  "matool_session_lost",
  "matool_snapshot_persistence_failed",
  "matool_sync_store_unavailable",
  "matool_unexpected_content_type",
  "matool_unexpected_status"
]);

export function isRetryableAreaError(code: string | undefined): boolean {
  if (!code) {
    return false;
  }
  // Eine unvollstaendig ausgelieferte Seite sieht wie ein Strukturfehler
  // aus; ein zweiter Versuch unterscheidet Aussetzer von echter Aenderung.
  return RETRYABLE_AREA_ERROR_CODES.has(code) || code.endsWith("_schema_mismatch");
}

/**
 * Liest und speichert genau einen Bereich: Sperre uebernehmen, MATOOL lesen,
 * gefenced speichern. Wirft nie; das Ergebnis sagt, ob ein weiterer Versuch
 * sinnvoll ist. Die Sperre bleibt beim Besitzer, bis der Lauf sie freigibt.
 */
export async function syncDirectArea(
  env: Env,
  area: string,
  options: DirectSyncAreaOptions
): Promise<DirectSyncAreaResult> {
  const runId = `snapshot_${area}_${crypto.randomUUID()}`;
  const areaStartedAt = new Date().toISOString();
  const { scheduledTime, syncId, trigger } = options;
  try {
    if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
      throw new AppError(
        "matool_not_configured",
        409,
        "Die MATOOL-Verbindung ist noch nicht eingerichtet."
      );
    }
    if (
      options.runDeadline !== undefined &&
      options.runDeadline - Date.now() < MATOOL_AREA_MIN_REMAINING_MS
    ) {
      throw new AppError(
        "matool_time_budget_exhausted",
        503,
        "Das Zeitbudget des Laufs war aufgebraucht; der Bereich folgt im naechsten Lauf."
      );
    }
    const credentials = {
      email: env.MATOOL_EMAIL,
      password: env.MATOOL_PASSWORD
    } satisfies MatoolCredentials;
    const cipher = await storedPayloadCipher(env);
    let activeLease = await acquireExactSyncLease(env.DB, options.leaseOwner);
    const heartbeat = async () => {
      activeLease = await renewLeaseHeartbeat(env.DB, activeLease);
    };

    let processedSourceIds: readonly string[] | undefined;
    const isExact = EXACT_CURRENT_SET_AREAS.has(area);
    let records: readonly MatoolSafeAreaRecord[];
    if (isExact) {
      records = await readMatchingExactSource(
        () => exactAreaSession(env, credentials, area),
        heartbeat
      );
    } else {
      const client = createDirectMatoolClient(env);
      const areaDeadline = options.areaDeadline;
      try {
        records = await readDirectArea(
          client,
          credentials,
          area,
          env.DB,
          options.detailLimit ?? detailLimitFor(area, trigger),
          heartbeat,
          areaDeadline === undefined
            ? undefined
            : () => Date.now() >= areaDeadline,
          (ids) => {
            processedSourceIds = ids;
          }
        );
      } finally {
        client.clearSession();
      }
    }
    if (isExact) {
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
            : area === "checkin"
              ? MATOOL_CHECKIN_PAYLOAD_FIELDS
              : area === "graduierungen"
                ? MATOOL_GRADUIERUNG_PAYLOAD_FIELDS
                : area === "checkin_historie"
                  ? MATOOL_CHECKIN_HISTORIE_PAYLOAD_FIELDS
                  : snapshotPayloadFields(records),
        area,
        finishedAt,
        observedAt: finishedAt,
        records,
        ...(isExact ? { replaceCurrentSet: true } : {}),
        runId,
        syncId,
        startedAt: areaStartedAt
      },
      cipher
    );
    if (area === "graduierungen" && processedSourceIds) {
      await markRotationRead(env.DB, area, processedSourceIds, finishedAt);
    }
    console.info(
      JSON.stringify({
        area,
        event: "matool_snapshot_succeeded",
        scheduledTime: new Date(scheduledTime).toISOString(),
        storedCount: result.storedCount
      })
    );
    return { area, status: "succeeded", storedCount: result.storedCount };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorCode = toAppError(error).code;
    if (error instanceof MatoolShapeMismatchError) {
      try {
        await recordMatoolResponseShape(env.DB, {
          area,
          observedAt: finishedAt,
          shape: error.shape
        });
      } catch {
        // Die Diagnose darf den Lauf nicht zusaetzlich stoeren.
      }
    }
    if (options.recordFailure !== false) {
      await recordDirectAreaFailure(env, {
        area,
        errorCode,
        runId,
        scheduledTime,
        startedAt: areaStartedAt,
        syncId
      });
    }
    console.error(
      JSON.stringify({
        area,
        errorCode,
        event: "matool_snapshot_failed",
        scheduledTime: new Date(scheduledTime).toISOString()
      })
    );
    return {
      area,
      errorCode,
      retryable: isRetryableAreaError(errorCode),
      status: "failed"
    };
  }
}

/** Vermerkt einen endgueltig gescheiterten Bereich; scheitert selbst nie. */
export async function recordDirectAreaFailure(
  env: Env,
  input: {
    area: string;
    errorCode: string;
    runId?: string;
    scheduledTime: number;
    startedAt?: string;
    syncId: string;
  }
): Promise<void> {
  const finishedAt = new Date().toISOString();
  try {
    await recordMatoolSnapshotFailure(env.DB, {
      area: input.area,
      errorCode: input.errorCode,
      finishedAt,
      runId: input.runId ?? `snapshot_${input.area}_${crypto.randomUUID()}`,
      syncId: input.syncId,
      startedAt: input.startedAt ?? finishedAt
    });
  } catch {
    console.error(
      JSON.stringify({
        area: input.area,
        errorCode: "matool_snapshot_failure_not_recorded",
        event: "matool_snapshot_failed",
        scheduledTime: new Date(input.scheduledTime).toISOString()
      })
    );
  }
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
    read: () => readDirectArea(client, credentials, area, env.DB)
  };
}

async function readDirectArea(
  client: MatoolClient,
  credentials: MatoolCredentials,
  area: string,
  db: D1Database,
  detailLimit: number = MATOOL_SCHUELER_DETAILS_PER_RUN,
  onProgress?: () => Promise<void>,
  shouldStop?: MatoolStopSignal,
  onProcessed?: (sourceIds: readonly string[]) => void
): Promise<MatoolSafeAreaRecord[]> {
  if (area === "klassen") {
    return (
      await client.extractKlassen(credentials, {
        maxRecords: MATOOL_KLASSEN_RECORDS_PER_RUN
      })
    ).records;
  }
  // Stammdaten sind keine Liste, sondern ein Abruf je Mitglied. Die
  // Kennungen stammen aus der bereits gelesenen Mitgliederliste.
  if (area === "schueler_details") {
    return (
      await client.extractSchuelerDetails(
        credentials,
        await selectSchuelerDetailSourceIds(db, detailLimit),
        onProgress,
        shouldStop
      )
    ).records;
  }
  if (area === "checkin") {
    return (await client.extractCheckins(credentials)).records;
  }
  // Eigene Rotation: Mitglieder ohne Pruefung haben keinen Datensatz, an
  // dem sich ablesen liesse, wann sie zuletzt abgefragt wurden.
  if (area === "graduierungen") {
    const result = await client.extractGraduierungen(
      credentials,
      await selectRotatingSourceIds(db, "graduierungen", detailLimit),
      onProgress,
      shouldStop
    );
    onProcessed?.(result.processedSourceIds ?? []);
    return result.records;
  }
  // Je Mitglied ein Datensatz mit allen Check-in-Daten; rotiert wie die
  // Stammdaten ueber den eigenen Bestand.
  if (area === "checkin_historie") {
    return (
      await client.extractCheckinHistorie(
        credentials,
        await selectSchuelerDetailSourceIds(db, detailLimit, "checkin_historie"),
        onProgress,
        shouldStop
      )
    ).records;
  }
  // Je Mitglied ein Datensatz mit allen Stilllegungszeitraeumen; rotiert
  // ueber den eigenen Bestand, damit jedes Mitglied regelmaessig frisch ist.
  if (area === "schueler_stilllegungen") {
    return (
      await client.extractStilllegungen(
        credentials,
        await selectSchuelerDetailSourceIds(
          db,
          detailLimit,
          "schueler_stilllegungen"
        ),
        onProgress,
        shouldStop
      )
    ).records;
  }
  return (await client.extractSafeArea(credentials, area)).records;
}
