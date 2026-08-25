import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  compareAreaParity,
  recordParityRun,
  repairCandidates
} from "../src/worker/parity";

const AREA = "interessenten";

async function seedSnapshot(
  sourceId: string,
  contentHash: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO matool_snapshots
       (area, source_id, first_seen_at, last_seen_at, content_hash,
        payload_json, last_run_id)
     VALUES (?, ?, '2026-08-25T08:00:00.000Z', '2026-08-25T08:00:00.000Z',
             ?, '{}', 'seed')
     ON CONFLICT(area, source_id) DO UPDATE SET content_hash = excluded.content_hash`
  )
    .bind(AREA, sourceId, contentHash)
    .run();
}

describe("Paritaetsnachweis", () => {
  beforeAll(async () => {
    await env.DB.prepare(`DELETE FROM matool_snapshots WHERE area = ?`)
      .bind(AREA)
      .run();
    // matool_snapshots verweist auf einen Lauf; ohne ihn greift die
    // Fremdschluesselpruefung.
    await env.DB.prepare(
      `INSERT INTO matool_snapshot_runs
         (run_id, area, status, started_at, finished_at,
          fetched_count, success_count, failure_count)
       VALUES ('seed', ?, 'succeeded',
               '2026-08-25T08:00:00.000Z', '2026-08-25T08:00:01.000Z', 0, 0, 0)
       ON CONFLICT(run_id) DO NOTHING`
    )
      .bind(AREA)
      .run();
    await seedSnapshot("1001", "a".repeat(64));
    await seedSnapshot("1002", "b".repeat(64));
    await seedSnapshot("1003", "c".repeat(64));
  });

  it("belegt Gleichstand, wenn jeder Hash uebereinstimmt", async () => {
    const result = await compareAreaParity(env.DB, AREA, "liste", [
      { sourceId: "1001", contentHash: "a".repeat(64) },
      { sourceId: "1002", contentHash: "b".repeat(64) },
      { sourceId: "1003", contentHash: "c".repeat(64) }
    ]);

    expect(result.status).toBe("parity");
    expect(result.equalCount).toBe(3);
    expect(result.differing).toBe(0);
    expect(result.missingInDb).toBe(0);
    expect(result.surplusInDb).toBe(0);
    expect(repairCandidates(result)).toEqual([]);
  });

  it("erkennt Feldabweichung, fehlenden und ueberzaehligen Datensatz", async () => {
    const result = await compareAreaParity(env.DB, AREA, "liste", [
      { sourceId: "1001", contentHash: "a".repeat(64) },
      // 1002 mit anderem Inhalt
      { sourceId: "1002", contentHash: "9".repeat(64) },
      // 1003 fehlt in MATOOL -> ueberzaehlig bei uns
      // 1004 ist neu in MATOOL -> fehlt bei uns
      { sourceId: "1004", contentHash: "d".repeat(64) }
    ]);

    expect(result.differing).toBe(1);
    expect(result.differingIds).toEqual(["1002"]);
    expect(result.missingInDb).toBe(1);
    expect(result.missingIds).toEqual(["1004"]);
    expect(result.surplusInDb).toBe(1);
    expect(result.surplusIds).toEqual(["1003"]);
    expect(result.status).toBe("failed"); // 3 von 3 auffaellig
  });

  it("verwirft einen Lauf mit auffaellig vielen Abweichungen", async () => {
    // Nur ein einziger Datensatz gelesen, obwohl drei gespeichert sind:
    // sieht nach unvollstaendigem Abruf aus, nicht nach echter Loeschung.
    const result = await compareAreaParity(env.DB, AREA, "liste", [
      { sourceId: "1001", contentHash: "a".repeat(64) }
    ]);

    expect(result.status).toBe("failed");
    // Ein verworfener Lauf darf nichts nachziehen und nichts loeschen.
    expect(repairCandidates(result)).toEqual([]);
  });

  it("ermittelt bei einer Stichprobe keine ueberzaehligen Datensaetze", async () => {
    const result = await compareAreaParity(env.DB, AREA, "stichprobe", [
      { sourceId: "1001", contentHash: "a".repeat(64) }
    ]);

    expect(result.surplusInDb).toBe(0);
    expect(result.status).toBe("parity");
  });

  it("meldet eine geringe Abweichung als drift und zieht sie nach", async () => {
    const viele = Array.from({ length: 30 }, (_, index) => ({
      contentHash: "e".repeat(64),
      sourceId: `2${index.toString().padStart(3, "0")}`
    }));
    for (const record of viele) {
      await seedSnapshot(record.sourceId, record.contentHash);
    }

    const gelesen = [
      { sourceId: "1001", contentHash: "a".repeat(64) },
      { sourceId: "1002", contentHash: "b".repeat(64) },
      { sourceId: "1003", contentHash: "c".repeat(64) },
      ...viele.slice(1),
      // genau ein abweichender Datensatz von 33
      { sourceId: viele[0]?.sourceId ?? "2000", contentHash: "f".repeat(64) }
    ];

    const result = await compareAreaParity(env.DB, AREA, "liste", gelesen);
    expect(result.status).toBe("drift");
    expect(repairCandidates(result)).toContain(viele[0]?.sourceId);
  });

  it("haelt das Ergebnis nachvollziehbar fest", async () => {
    const result = await compareAreaParity(env.DB, AREA, "liste", [
      { sourceId: "1001", contentHash: "a".repeat(64) }
    ]);
    await recordParityRun(
      env.DB,
      result,
      {
        finishedAt: "2026-08-25T09:00:05.000Z",
        startedAt: "2026-08-25T09:00:00.000Z"
      },
      0
    );

    const row = await env.DB.prepare(
      `SELECT area, scope, status FROM matool_parity_runs
       ORDER BY started_at DESC LIMIT 1`
    ).first<{ area: string; scope: string; status: string }>();

    expect(row).toMatchObject({
      area: AREA,
      scope: "liste",
      status: "failed"
    });
  });
});
