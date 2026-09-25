import { toAppError } from "../core/app-error";
import type { Env } from "./env";
import { pruneLoginThrottle } from "./login-throttle";
import {
  STORED_PAYLOAD_HEADER_LENGTH,
  storedPayloadCipher,
  type StoredPayloadCipher
} from "./payload-encryption";

const SEAL_BATCH_SIZE = 50;
const MAX_SEALED_PER_RUN = 5_000;
const DEFAULT_CHANGE_PAYLOAD_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface DataProtectionStatus {
  encryptionConfigured: boolean;
  unprotectedPayloads: number;
}

export interface DataProtectionMaintenanceResult extends DataProtectionStatus {
  expiredChangePayloads: number;
  sealedPayloads: number;
}

interface CountRow {
  count: number;
}

interface SnapshotPayloadRow {
  area: string;
  payload_json: string;
  source_id: string;
}

interface ChangePayloadRow extends SnapshotPayloadRow {
  change_id: number;
}

/**
 * Laeuft bei jedem Cron-Aufruf, unabhaengig vom MATOOL-Zeitfenster:
 * 1. loescht Kopien alter Datensatzstaende aus der Aenderungshistorie,
 * 2. verschluesselt Altbestand bzw. versiegelt nach Schluesselwechsel neu,
 * 3. entfernt abgelaufene Eintraege der Login-Sperre.
 */
export async function runDataProtectionMaintenance(
  env: Env,
  now = new Date()
): Promise<DataProtectionMaintenanceResult> {
  const expiredChangePayloads = await expireChangePayloads(env, now);
  const cipher = await storedPayloadCipher(env);
  const sealedPayloads = cipher.currentHeader
    ? await sealStoredPayloads(env.DB, cipher, cipher.currentHeader)
    : 0;
  await pruneLoginThrottle(env.DB, Math.floor(now.getTime() / 1000));
  const status = await dataProtectionStatus(env, cipher);
  return { ...status, expiredChangePayloads, sealedPayloads };
}

/** Wie runDataProtectionMaintenance, aber ohne den Cron-Lauf abzubrechen. */
export async function runDataProtectionMaintenanceSafely(
  env: Env,
  now = new Date()
): Promise<void> {
  try {
    const result = await runDataProtectionMaintenance(env, now);
    console.info(
      JSON.stringify({ event: "data_protection_maintenance", ...result })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "data_protection_maintenance_failed",
        errorCode: toAppError(error).code
      })
    );
  }
}

export async function dataProtectionStatus(
  env: Env,
  cipher?: StoredPayloadCipher
): Promise<DataProtectionStatus> {
  const activeCipher = cipher ?? (await storedPayloadCipher(env));
  // Ohne Schluessel zaehlt alles als ungeschuetzt, was nicht versiegelt ist.
  const header = activeCipher.currentHeader ?? "enc:";
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM matool_snapshots
        WHERE substr(payload_json, 1, ?) <> ?)
       + (SELECT COUNT(*) FROM matool_snapshot_changes
          WHERE payload_json IS NOT NULL
            AND substr(payload_json, 1, ?) <> ?) AS count`
  )
    .bind(header.length, header, header.length, header)
    .first<CountRow>();
  return {
    encryptionConfigured: activeCipher.currentHeader !== null,
    unprotectedPayloads: row?.count ?? 0
  };
}

/**
 * Die Aenderungshistorie speichert jeden alten Stand vollstaendig, also auch
 * alte IBANs und Anschriften. Nach Ablauf der Frist bleibt nur die
 * Metadatenzeile (wann, was fuer eine Aenderung) erhalten. Ein noch
 * ausstehender Zapier-Versand behaelt seine Nutzlast.
 */
async function expireChangePayloads(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(
    now.getTime() - changePayloadRetentionDays(env) * DAY_MS
  ).toISOString();
  const result = await env.DB.prepare(
    `UPDATE matool_snapshot_changes
     SET payload_json = NULL
     WHERE payload_json IS NOT NULL
       AND observed_at < ?
       AND change_id NOT IN (
         SELECT pending_change_id
         FROM zapier_snapshot_subscriptions
         WHERE pending_change_id IS NOT NULL
       )`
  )
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

function changePayloadRetentionDays(env: Env): number {
  const configured = Number.parseInt(
    env.CHANGE_PAYLOAD_RETENTION_DAYS ?? "",
    10
  );
  return Number.isSafeInteger(configured) && configured >= 1
    ? Math.min(configured, 3_650)
    : DEFAULT_CHANGE_PAYLOAD_RETENTION_DAYS;
}

/**
 * Versiegelt alle Nutzlasten, die nicht mit dem aktuellen Schluessel
 * verschluesselt sind: Klartext aus der Zeit vor der Verschluesselung und
 * Chiffrat eines vorherigen Schluessels. Das UPDATE greift nur, solange die
 * Zeile unveraendert ist, damit ein paralleler Sync nie ueberschrieben wird.
 */
async function sealStoredPayloads(
  db: D1Database,
  cipher: StoredPayloadCipher,
  header: string
): Promise<number> {
  let sealed = 0;
  while (sealed < MAX_SEALED_PER_RUN) {
    const snapshots = await db
      .prepare(
        `SELECT area, source_id, payload_json
         FROM matool_snapshots
         WHERE substr(payload_json, 1, ?) <> ?
         LIMIT ?`
      )
      .bind(STORED_PAYLOAD_HEADER_LENGTH, header, SEAL_BATCH_SIZE)
      .all<SnapshotPayloadRow>();
    const changes = await db
      .prepare(
        `SELECT change_id, area, source_id, payload_json
         FROM matool_snapshot_changes
         WHERE payload_json IS NOT NULL
           AND substr(payload_json, 1, ?) <> ?
         LIMIT ?`
      )
      .bind(STORED_PAYLOAD_HEADER_LENGTH, header, SEAL_BATCH_SIZE)
      .all<ChangePayloadRow>();
    if (snapshots.results.length === 0 && changes.results.length === 0) {
      break;
    }

    const statements = await Promise.all([
      ...snapshots.results.map(async (row) =>
        db
          .prepare(
            `UPDATE matool_snapshots
             SET payload_json = ?
             WHERE area = ? AND source_id = ? AND payload_json = ?`
          )
          .bind(
            await reseal(cipher, row),
            row.area,
            row.source_id,
            row.payload_json
          )
      ),
      ...changes.results.map(async (row) =>
        db
          .prepare(
            `UPDATE matool_snapshot_changes
             SET payload_json = ?
             WHERE change_id = ? AND payload_json = ?`
          )
          .bind(await reseal(cipher, row), row.change_id, row.payload_json)
      )
    ]);
    await db.batch(statements);
    sealed += statements.length;
  }
  return sealed;
}

async function reseal(
  cipher: StoredPayloadCipher,
  row: SnapshotPayloadRow
): Promise<string> {
  const context = { area: row.area, sourceId: row.source_id };
  return cipher.seal(context, await cipher.open(context, row.payload_json));
}
