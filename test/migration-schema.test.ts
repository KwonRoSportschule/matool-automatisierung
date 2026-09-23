import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface ColumnInfo {
  dflt_value: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
}

// setup.ts applies the real migration directory to a fresh local D1 database.
// No application schema helper is called here: these checks must also pass
// before any Worker or workflow has had a chance to create missing tables.
describe("reproduzierbare D1-Migrationskette", () => {
  it("fuehrt historische Schemaergaenzungen aus, aber keine archivierten Doppelvarianten", () => {
    const names = env.TEST_MIGRATIONS.map((migration) => migration.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "0007_exact_sync_fencing.sql",
        "0008_diagnose.sql",
        "0009_zapier_snapshot_change_kind_filter.sql",
        "0010_interessenten_sync_staged_lists.sql",
        "0010_darstellungsfelder_entfernen.sql",
        "0010_zapier_snapshot_new_only.sql"
      ])
    );
    expect(names).not.toContain("0007_diagnose.sql");
    expect(names).not.toContain("0008_exact_sync_fencing.sql");
    expect(new Set(names).size).toBe(names.length);
  });

  it("legt Staging-Listen mit beiden Hashfeldern und zusammengesetztem Schluessel an", async () => {
    const columns = await env.DB
      .prepare("PRAGMA table_info(interessenten_sync_staged_lists)")
      .all<ColumnInfo>();

    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "job_id", notnull: 1, pk: 1 }),
        expect.objectContaining({ name: "source_id", notnull: 1, pk: 2 }),
        expect.objectContaining({ name: "payload_json", notnull: 1 }),
        expect.objectContaining({ name: "content_hash", notnull: 1 }),
        expect.objectContaining({ name: "zapier_event_id", notnull: 1 })
      ])
    );
  });

  it("erhaelt beide Zapier-Filtergenerationen und den historischen Filterindex", async () => {
    const columns = await env.DB
      .prepare("PRAGMA table_info(zapier_snapshot_subscriptions)")
      .all<ColumnInfo>();

    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "only_changed", notnull: 1 }),
        expect.objectContaining({
          name: "only_new",
          notnull: 1,
          dflt_value: "0"
        }),
        expect.objectContaining({
          name: "change_kind_filter",
          notnull: 1,
          dflt_value: "'any'"
        })
      ])
    );

    const index = await env.DB
      .prepare("PRAGMA index_info(idx_zapier_snapshot_subscriptions_active_kind)")
      .all<{ name: string; seqno: number }>();
    expect(index.results.map((column) => column.name)).toEqual([
      "status",
      "area",
      "change_kind_filter"
    ]);
  });

  it("legt beide Fence-Trigger bereits durch Migrationen an", async () => {
    const triggers = await env.DB
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'trigger' AND tbl_name = 'matool_exact_sync_fence_checks'
         ORDER BY name`
      )
      .all<{ name: string }>();

    expect(triggers.results.map((trigger) => trigger.name)).toEqual([
      "matool_exact_sync_fence_check_insert",
      "matool_exact_sync_fence_check_update"
    ]);
  });

  it("laesst eine erneute Anwendung ohne ausstehende Migrationen unveraendert", async () => {
    const readAppliedNames = () => env.DB
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    const before = await readAppliedNames();

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    const after = await readAppliedNames();
    expect(after.results).toEqual(before.results);
    expect(after.results.map((migration) => migration.name)).toEqual(
      env.TEST_MIGRATIONS.map((migration) => migration.name).sort()
    );
    const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeys.results).toEqual([]);
  });
});
