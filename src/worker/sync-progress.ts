/**
 * Fortschritt des laufenden Gesamtabrufs fuer die Karte oben im Dashboard.
 *
 * Ein Bereich meldet sich erst, wenn er fertig ist. Innerhalb des laufenden
 * Bereichs ist der Fortschritt deshalb geschaetzt: aus dem Durchschnitt der
 * letzten fuenf erfolgreichen Laeufe dieses Bereichs mit demselben Ausloeser
 * (Stundenlauf bzw. manuell). Dauert ein Bereich laenger, waechst die
 * Schaetzung mit; der Balken bleibt unter 100 %, bis der Lauf wirklich endet.
 *
 * Als aktiv gilt nur ein Lauf, waehrend jemand die Sperre haelt -- ein von
 * Cloudflare abgebrochener Lauf erscheint also nicht als "laeuft".
 */

import { areaLabel } from "./dashboard-privacy";
import { isDirectSyncLeaseHeld } from "./direct-sync-store";
import { MATOOL_DIRECT_SNAPSHOT_AREAS } from "./schedule";

export type SyncProgressAreaState = "done" | "running" | "waiting" | "failed";

export interface SyncProgressArea {
  area: string;
  label: string;
  state: SyncProgressAreaState;
  /** Geschaetzte Gesamtdauer des Bereichs in ms (bei "done" die echte). */
  estimateMs: number;
  /** 0 bis 1; beim laufenden Bereich geschaetzt, hoechstens 0,95. */
  fraction: number;
  errorCode: string | null;
}

export interface SyncProgress {
  syncId: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  now: string;
  percent: number;
  remainingMs: number;
  estimatedFinishAt: string;
  current: { area: string; label: string } | null;
  areas: SyncProgressArea[];
}

/** Ohne Vergleichslaeufe angenommene Dauer eines Bereichs. */
const DEFAULT_AREA_MS = 90_000;
/** Laeuft ein Bereich laenger als geschaetzt, bleibt mindestens so viel Rest. */
const MIN_REMAINING_WHEN_OVERDUE_MS = 30_000;
/** Aeltere "laufende" Laeufe sind abgebrochen (vgl. sync-store.ts). */
const MAX_RUN_AGE_MS = 30 * 60 * 1_000;
const HISTORY_RUNS = 5;

/** Kurze Namen fuer die Karte; sonst die Beschriftung des Dashboards. */
const PROGRESS_LABELS: Readonly<Record<string, string>> = {
  schueler_details: "Mitglieder-Stammdaten"
};

function label(area: string): string {
  return PROGRESS_LABELS[area] ?? areaLabel(area);
}

interface RunningSyncRow {
  started_at: string;
  sync_id: string;
  trigger_kind: "manual" | "scheduled";
}

interface AreaRunRow {
  area: string;
  error_code: string | null;
  finished_at: string;
  started_at: string;
  status: "failed" | "succeeded";
}

export async function getSyncProgress(
  db: D1Database,
  now: Date = new Date()
): Promise<SyncProgress | null> {
  if (!(await isDirectSyncLeaseHeld(db, now))) {
    return null;
  }
  const aeltester = new Date(now.getTime() - MAX_RUN_AGE_MS).toISOString();
  let run: RunningSyncRow | null;
  try {
    run = await db
      .prepare(
        `SELECT sync_id, trigger_kind, started_at
         FROM matool_sync_runs
         WHERE status = 'running' AND started_at >= ?
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .bind(aeltester)
      .first<RunningSyncRow>();
  } catch {
    return null;
  }
  if (!run) {
    return null;
  }

  const [erledigt, historie] = await Promise.all([
    db
      .prepare(
        `SELECT area, status, started_at, finished_at, error_code
         FROM matool_snapshot_runs
         WHERE sync_id = ?`
      )
      .bind(run.sync_id)
      .all<AreaRunRow>(),
    db
      .prepare(
        `SELECT runs.area, runs.status, runs.started_at, runs.finished_at, runs.error_code
         FROM matool_snapshot_runs AS runs
         JOIN matool_sync_runs AS sync ON sync.sync_id = runs.sync_id
         WHERE sync.trigger_kind = ?
           AND runs.status = 'succeeded'
           AND runs.sync_id <> ?
         ORDER BY runs.started_at DESC
         LIMIT 400`
      )
      .bind(run.trigger_kind, run.sync_id)
      .all<AreaRunRow>()
  ]);

  return berechneFortschritt({
    areas: MATOOL_DIRECT_SNAPSHOT_AREAS,
    done: erledigt.results,
    history: historie.results,
    now,
    startedAt: run.started_at,
    syncId: run.sync_id,
    trigger: run.trigger_kind
  });
}

/** Reine Rechnung, getrennt von D1 testbar. */
export function berechneFortschritt(input: {
  areas: readonly string[];
  done: readonly AreaRunRow[];
  history: readonly AreaRunRow[];
  now: Date;
  startedAt: string;
  syncId: string;
  trigger: "manual" | "scheduled";
}): SyncProgress {
  const dauer = (row: AreaRunRow) =>
    Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at));
  const schaetzung = new Map<string, number>();
  for (const area of input.areas) {
    const letzte = input.history
      .filter((row) => row.area === area && Number.isFinite(dauer(row)))
      .slice(0, HISTORY_RUNS)
      .map(dauer);
    schaetzung.set(
      area,
      letzte.length > 0
        ? Math.round(letzte.reduce((summe, wert) => summe + wert, 0) / letzte.length)
        : DEFAULT_AREA_MS
    );
  }
  const fertig = new Map(input.done.map((row) => [row.area, row]));
  const now = input.now.getTime();
  const start = Date.parse(input.startedAt);

  let cursor = start;
  let rest = 0;
  let current: SyncProgress["current"] = null;
  const areas: SyncProgressArea[] = [];
  for (const area of input.areas) {
    const row = fertig.get(area);
    if (row) {
      cursor = Math.max(cursor, Date.parse(row.finished_at));
      areas.push({
        area,
        label: label(area),
        state: row.status === "succeeded" ? "done" : "failed",
        estimateMs: dauer(row),
        fraction: 1,
        errorCode: row.error_code
      });
      continue;
    }
    const geschaetzt = schaetzung.get(area) ?? DEFAULT_AREA_MS;
    if (current === null) {
      const vergangen = Math.max(0, now - cursor);
      const erwartet = Math.max(geschaetzt, vergangen + MIN_REMAINING_WHEN_OVERDUE_MS);
      rest += erwartet - vergangen;
      current = { area, label: label(area) };
      areas.push({
        area,
        label: label(area),
        state: "running",
        estimateMs: erwartet,
        fraction: Math.min(0.95, vergangen / erwartet),
        errorCode: null
      });
      continue;
    }
    rest += geschaetzt;
    areas.push({
      area,
      label: label(area),
      state: "waiting",
      estimateMs: geschaetzt,
      fraction: 0,
      errorCode: null
    });
  }

  const vergangen = Math.max(0, now - start);
  const gesamt = vergangen + rest;
  const percent =
    gesamt > 0 ? Math.min(99, Math.max(1, Math.floor((vergangen / gesamt) * 100))) : 1;
  return {
    syncId: input.syncId,
    trigger: input.trigger,
    startedAt: input.startedAt,
    now: input.now.toISOString(),
    percent,
    remainingMs: rest,
    estimatedFinishAt: new Date(now + rest).toISOString(),
    current,
    areas
  };
}
