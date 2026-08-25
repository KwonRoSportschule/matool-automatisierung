import { AppError } from "../core/app-error";

/**
 * Paritaetsnachweis: belegt feldweise, dass der gespeicherte Bestand mit
 * MATOOL uebereinstimmt.
 *
 * Ein reiner Mengenvergleich uebersieht falsche Feldwerte. Deshalb wird je
 * Datensatz der Inhaltshash verglichen, der beim Speichern aus dem
 * kanonisierten Payload gebildet wurde.
 */

/** Anteil auffaelliger Datensaetze, ab dem ein Lauf verworfen wird. */
const PARITY_DRIFT_LIMIT = 0.1;

/** Obergrenze fuer die je Ergebnis gefuehrten Kennungen. */
const MAX_REPORTED_IDS = 500;

export type ParityScope = "liste" | "stichprobe" | "vollstaendig";
export type ParityStatus = "parity" | "drift" | "failed";

export interface ParityCandidate {
  contentHash: string;
  sourceId: string;
}

export interface ParityResult {
  area: string;
  dbCount: number;
  differing: number;
  differingIds: string[];
  equalCount: number;
  matoolCount: number;
  missingIds: string[];
  missingInDb: number;
  scope: ParityScope;
  status: ParityStatus;
  surplusIds: string[];
  surplusInDb: number;
}

interface StoredHashRow {
  content_hash: string;
  source_id: string;
}

/**
 * Vergleicht den frisch aus MATOOL gelesenen Bestand mit dem gespeicherten.
 *
 * `matoolRecords` muss der **vollstaendige** Bestand des Bereichs sein.
 * Bei einer Stichprobe werden ueberzaehlige Datensaetze nicht ermittelt,
 * weil ein fehlender Datensatz dann nichts ueber MATOOL aussagt.
 */
export async function compareAreaParity(
  db: D1Database,
  area: string,
  scope: ParityScope,
  matoolRecords: readonly ParityCandidate[]
): Promise<ParityResult> {
  if (area.length === 0 || area.length > 64) {
    throw new AppError(
      "invalid_parity_area",
      400,
      "Der Bereich für den Paritätsnachweis ist ungültig."
    );
  }

  const stored = await readStoredHashes(db, area);
  const gelesen = new Map<string, string>();
  for (const record of matoolRecords) {
    if (record.sourceId.length > 0) {
      gelesen.set(record.sourceId, record.contentHash);
    }
  }

  const differingIds: string[] = [];
  const missingIds: string[] = [];
  const surplusIds: string[] = [];
  let equalCount = 0;

  for (const [sourceId, hash] of gelesen) {
    const gespeichert = stored.get(sourceId);
    if (gespeichert === undefined) {
      pushBounded(missingIds, sourceId);
    } else if (gespeichert === hash) {
      equalCount += 1;
    } else {
      pushBounded(differingIds, sourceId);
    }
  }

  // Ueberzaehlige nur aus einem vollstaendigen Abruf ableiten: Bei einer
  // Stichprobe fehlt der Beleg, dass der Datensatz in MATOOL wirklich weg ist.
  if (scope !== "stichprobe") {
    for (const sourceId of stored.keys()) {
      if (!gelesen.has(sourceId)) {
        pushBounded(surplusIds, sourceId);
      }
    }
  }

  const matoolCount = gelesen.size;
  const differing = differingIds.length;
  const missingInDb = missingIds.length;
  const surplusInDb = surplusIds.length;
  const auffaellig = differing + missingInDb + surplusInDb;

  return {
    area,
    dbCount: stored.size,
    differing,
    differingIds,
    equalCount,
    matoolCount,
    missingIds,
    missingInDb,
    scope,
    status: bewerte(auffaellig, matoolCount),
    surplusIds,
    surplusInDb
  };
}

/**
 * Ein Lauf mit auffaellig vielen Abweichungen wird verworfen: Wahrscheinlicher
 * als ein echter Massenwechsel ist ein unvollstaendiger Abruf. Es wird dann
 * nichts nachgezogen und nichts geloescht.
 */
function bewerte(auffaellig: number, matoolCount: number): ParityStatus {
  if (auffaellig === 0) {
    return "parity";
  }
  if (matoolCount === 0) {
    return "failed";
  }
  return auffaellig / matoolCount > PARITY_DRIFT_LIMIT ? "failed" : "drift";
}

function pushBounded(ziel: string[], sourceId: string): void {
  if (ziel.length < MAX_REPORTED_IDS) {
    ziel.push(sourceId);
  }
}

async function readStoredHashes(
  db: D1Database,
  area: string
): Promise<Map<string, string>> {
  const rows = await db
    .prepare(
      `SELECT source_id, content_hash
       FROM matool_snapshots
       WHERE area = ?`
    )
    .bind(area)
    .all<StoredHashRow>();

  const stored = new Map<string, string>();
  for (const row of rows.results) {
    stored.set(row.source_id, row.content_hash);
  }
  return stored;
}

/** Haelt das Ergebnis eines Paritaetslaufs fest. */
export async function recordParityRun(
  db: D1Database,
  result: ParityResult,
  zeiten: { finishedAt: string; startedAt: string },
  repaired = 0
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO matool_parity_runs (
         parity_id, area, scope, started_at, finished_at,
         matool_count, db_count, equal_count,
         differing, missing_in_db, surplus_in_db, repaired, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `parity_${result.area}_${crypto.randomUUID()}`,
      result.area,
      result.scope,
      zeiten.startedAt,
      zeiten.finishedAt,
      result.matoolCount,
      result.dbCount,
      result.equalCount,
      result.differing,
      result.missingInDb,
      result.surplusInDb,
      repaired,
      result.status
    )
    .run();
}

/**
 * Datensaetze, die nachgezogen werden sollten. Bei einem verworfenen Lauf
 * bleibt die Liste leer: Dort wird bewusst nichts veraendert.
 */
export function repairCandidates(result: ParityResult): string[] {
  if (result.status === "failed") {
    return [];
  }
  return [...result.differingIds, ...result.missingIds];
}
