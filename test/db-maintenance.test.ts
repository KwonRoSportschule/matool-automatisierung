import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { runDatabaseMaintenance } from "../src/worker/db-maintenance";
import type { Env } from "../src/worker/env";
import { ensureInteressentenSyncSchema } from "../src/worker/interessenten-sync-store";

describe("selbstlaufende Datenbankpflege", () => {
  it("legt Indizes an, loescht nur technische Hilfsdaten und laesst Tabellen stehen", async () => {
    const jetzt = new Date("2098-07-01T12:00:00.000Z");
    await ensureInteressentenSyncSchema(env.DB);
    await env.DB.prepare("DROP INDEX IF EXISTS idx_matool_snapshot_changes_run").run();

    // Fortschritt eines laengst ersetzten Interessentenjobs.
    await env.DB.prepare(
      `INSERT INTO interessenten_sync_progress_batches (
         job_id, batch_key, completed_detail_count, created_count, updated_count,
         error_count, applied, created_at
       ) VALUES ('pflege_alter_job', 'b1', 1, 0, 0, 0, 1, '2098-01-01T00:00:00.000Z')`
    ).run();
    // Uebersprungener Lauf: alt wird geloescht, neu bleibt.
    const skipped = (id: string, zeit: string) =>
      env.DB.prepare(
        `INSERT INTO matool_sync_runs (sync_id, trigger_kind, scheduled_for, started_at,
           finished_at, status, skip_reason)
         VALUES (?, 'scheduled', ?, ?, ?, 'skipped', 'outside_schedule_window')`
      ).bind(id, zeit, zeit, zeit).run();
    await skipped("pflege_skip_alt", "2098-04-01T06:00:00.000Z");
    await skipped("pflege_skip_neu", "2098-06-30T06:00:00.000Z");
    // Ein echter Lauf bleibt immer, egal wie alt.
    await env.DB.prepare(
      `INSERT INTO matool_sync_runs (sync_id, trigger_kind, started_at, finished_at, status)
       VALUES ('pflege_lauf_alt', 'scheduled', '2097-01-01T06:00:00.000Z',
               '2097-01-01T06:10:00.000Z', 'succeeded')`
    ).run();

    const result = await runDatabaseMaintenance(env as unknown as Env, jetzt);

    expect(result.indexesEnsured).toBe(3);
    expect(result.deleted.interessenten_sync_progress_batches).toBeGreaterThanOrEqual(1);
    const index = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_matool_snapshot_changes_run'"
    ).first();
    expect(index).not.toBeNull();

    const laeufe = await env.DB.prepare(
      "SELECT sync_id FROM matool_sync_runs WHERE sync_id LIKE 'pflege_%' ORDER BY sync_id"
    ).all<{ sync_id: string }>();
    expect(laeufe.results.map((row) => row.sync_id)).toEqual([
      "pflege_lauf_alt",
      "pflege_skip_neu"
    ]);

    // Ein zweiter Lauf ist ein No-op.
    const zweiter = await runDatabaseMaintenance(env as unknown as Env, jetzt);
    expect(zweiter.deleted.matool_sync_runs_skipped).toBe(0);
    expect(zweiter.deleted.interessenten_sync_progress_batches).toBe(0);
  });
});
