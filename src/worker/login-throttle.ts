import { AppError } from "../core/app-error";
import { hmacSha256Base64Url, sha256Hex } from "../core/crypto";
import type { Env } from "./env";

/**
 * Bremst das Durchprobieren von Dashboard-Passwoertern: Nach zehn
 * Fehlversuchen innerhalb von 15 Minuten ist die Herkunft 15 Minuten
 * gesperrt, auch fuer richtige Zugangsdaten.
 */
export const LOGIN_MAX_FAILURES = 10;
const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
export const LOGIN_LOCK_SECONDS = 15 * 60;
const LOGIN_THROTTLE_RETENTION_SECONDS = 24 * 60 * 60;

export class LoginLockedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      "dashboard_login_locked",
      429,
      `Zu viele Fehlversuche. Bitte in ${minutes} Minuten erneut versuchen.`
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface LoginThrottleRow {
  locked_until: number | null;
}

let schemaReady: Promise<void> | null = null;

/**
 * Die IP-Adresse ist selbst ein Personendatum. Gespeichert wird deshalb nur
 * ein HMAC; ohne Schluessel waere ein IPv4-Hash in Minuten umkehrbar.
 */
export async function loginThrottleBucket(
  request: Request,
  env: Env
): Promise<string> {
  const origin = request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
  const secret = env.DATA_ENCRYPTION_KEY || env.CSRF_SECRET;
  return secret
    ? hmacSha256Base64Url(`dashboard-login-throttle:${secret}`, origin)
    : sha256Hex(`dashboard-login-throttle:${origin}`);
}

/** Wirft LoginLockedError; liefert true, wenn Fehlversuche vorliegen. */
export async function assertLoginNotLocked(
  db: D1Database,
  bucket: string,
  nowSeconds: number
): Promise<boolean> {
  await ensureLoginThrottleSchema(db);
  const row = await db
    .prepare(
      `SELECT locked_until
       FROM dashboard_login_throttle
       WHERE bucket = ?`
    )
    .bind(bucket)
    .first<LoginThrottleRow>();
  if (row?.locked_until && row.locked_until > nowSeconds) {
    throw new LoginLockedError(row.locked_until - nowSeconds);
  }
  return row !== null;
}

export async function recordLoginFailure(
  db: D1Database,
  bucket: string,
  nowSeconds: number
): Promise<void> {
  await ensureLoginThrottleSchema(db);
  const windowStart = nowSeconds - LOGIN_FAILURE_WINDOW_SECONDS;
  // In ON CONFLICT DO UPDATE sehen alle Ausdruecke die alte Zeile.
  await db
    .prepare(
      `INSERT INTO dashboard_login_throttle (
         bucket, failure_count, window_started_at, locked_until, updated_at
       ) VALUES (?, 1, ?, NULL, ?)
       ON CONFLICT (bucket) DO UPDATE SET
         failure_count = CASE
           WHEN window_started_at <= ? THEN 1
           ELSE failure_count + 1
         END,
         window_started_at = CASE
           WHEN window_started_at <= ? THEN excluded.window_started_at
           ELSE window_started_at
         END,
         locked_until = CASE
           WHEN window_started_at > ? AND failure_count + 1 >= ? THEN ?
           ELSE locked_until
         END,
         updated_at = excluded.updated_at`
    )
    .bind(
      bucket,
      nowSeconds,
      nowSeconds,
      windowStart,
      windowStart,
      windowStart,
      LOGIN_MAX_FAILURES,
      nowSeconds + LOGIN_LOCK_SECONDS
    )
    .run();
}

export async function clearLoginFailures(
  db: D1Database,
  bucket: string
): Promise<void> {
  await db
    .prepare("DELETE FROM dashboard_login_throttle WHERE bucket = ?")
    .bind(bucket)
    .run();
}

export async function pruneLoginThrottle(
  db: D1Database,
  nowSeconds: number
): Promise<number> {
  await ensureLoginThrottleSchema(db);
  const result = await db
    .prepare(
      `DELETE FROM dashboard_login_throttle
       WHERE updated_at < ?
         AND (locked_until IS NULL OR locked_until < ?)`
    )
    .bind(nowSeconds - LOGIN_THROTTLE_RETENTION_SECONDS, nowSeconds)
    .run();
  return result.meta.changes ?? 0;
}

/** Wie Migration 0010, damit kein manueller Migrationsschritt noetig ist. */
async function ensureLoginThrottleSchema(db: D1Database): Promise<void> {
  schemaReady ??= db
    .batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS dashboard_login_throttle (
        bucket TEXT PRIMARY KEY,
        failure_count INTEGER NOT NULL CHECK (failure_count > 0),
        window_started_at INTEGER NOT NULL,
        locked_until INTEGER,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_dashboard_login_throttle_updated
        ON dashboard_login_throttle (updated_at)`)
    ])
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  await schemaReady;
}
