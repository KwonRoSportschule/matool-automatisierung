import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatoolClient } from "../src/matool/client";
import {
  markRotationRead,
  selectRotatingSourceIds
} from "../src/worker/detail-rotation";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";
import {
  collectMatoolSnapshots,
  detailAreaDeadline,
  MATOOL_DETAIL_AREA_BUDGET_MS,
  MATOOL_SCHEDULED_RUN_BUDGET_MS
} from "../src/worker/schedule";
import {
  beginMatoolSyncRun,
  markAbandonedMatoolSyncRuns
} from "../src/worker/sync-store";

const credentials = {
  email: "service-account@example.invalid",
  password: "synthetic-password"
};

const testEnv = {
  ...env,
  MATOOL_EMAIL: credentials.email,
  MATOOL_PASSWORD: credentials.password,
  OUTBOUND_DELIVERY_ENABLED: "false"
};

/** Login (3 Antworten), danach je Anfrage die gegebene Antwort. */
function clientMitAntworten(
  jeAnfrage: (path: string) => Response
): { client: MatoolClient; pfade: string[] } {
  const pfade: string[] = [];
  const login = [
    new Response("<html>Session</html>", { status: 200 }),
    new Response(null, { headers: { Location: "/index.php" }, status: 302 }),
    new Response("<html>Angemeldet</html>", { status: 200 })
  ];
  const client = new MatoolClient(
    "https://core.matool.de",
    (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      pfade.push(url.pathname);
      return login.shift() ?? jeAnfrage(url.pathname);
    }) as typeof fetch
  );
  return { client, pfade };
}

async function seedMitgliederliste(sourceIds: string[], observedAt: string) {
  await persistMatoolSnapshotRun(
    env.DB,
    {
      allowedPayloadFields: ["status"],
      area: "schueler",
      finishedAt: observedAt,
      observedAt,
      records: sourceIds.map((sourceId) => ({
        payload: { status: "SYNTHETISCH" },
        sourceId
      })),
      runId: `zeitbudget_liste_${crypto.randomUUID()}`,
      startedAt: observedAt
    },
    await storedPayloadCipher(env)
  );
}

describe("Zeitbudget des Stundenlaufs", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "DELETE FROM matool_snapshots WHERE area IN ('schueler', 'graduierungen')"
    ).run();
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS matool_detail_rotation (area TEXT NOT NULL, source_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (area, source_id))"
    ).run();
    await env.DB.prepare("DELETE FROM matool_detail_rotation").run();
  });
  afterEach(() => vi.restoreAllMocks());

  it("bleibt mit allen Detailbudgets unter dem 15-Minuten-Limit von Cloudflare", () => {
    expect(MATOOL_SCHEDULED_RUN_BUDGET_MS).toBeLessThanOrEqual(13 * 60_000);
    const summe = Object.values(MATOOL_DETAIL_AREA_BUDGET_MS).reduce(
      (gesamt, wert) => gesamt + wert,
      0
    );
    expect(summe).toBeLessThan(MATOOL_SCHEDULED_RUN_BUDGET_MS);
  });

  it("laesst spaeteren Detailbereichen ihre Mindestzeit", () => {
    const jetzt = 1_000_000;
    const ende = jetzt + 5 * 60_000;
    // Eigenes Budget (4 Min.) waere laenger als erlaubt: Zwei spaetere
    // Bereiche brauchen je 90 s.
    expect(
      detailAreaDeadline(
        "schueler_stilllegungen",
        ["schueler_details", "graduierungen"],
        ende,
        jetzt
      )
    ).toBe(ende - 180_000);
    // Genug Zeit: das eigene Budget gilt.
    expect(
      detailAreaDeadline("schueler_details", ["graduierungen"], jetzt + 60 * 60_000, jetzt)
    ).toBe(jetzt + MATOOL_DETAIL_AREA_BUDGET_MS.schueler_details!);
    // Handlauf ohne Laufende: kein Limit.
    expect(detailAreaDeadline("graduierungen", [], undefined, jetzt)).toBeUndefined();
  });

  it("liest Graduierungen nur bis zum Stoppsignal und meldet die gelesenen Mitglieder", async () => {
    const { client, pfade } = clientMitAntworten(
      () => new Response("[]", { status: 200 })
    );
    let gefragt = 0;
    const result = await client.extractGraduierungen(
      credentials,
      ["700001", "700002", "700003"],
      undefined,
      () => {
        gefragt += 1;
        return gefragt > 1;
      }
    );

    // Vor dem 2. Mitglied: weiter, vor dem 3.: Stopp.
    expect(gefragt).toBe(2);
    expect(result.processedSourceIds).toEqual(["700001", "700002"]);
    expect(pfade.filter((pfad) => pfad === "/json/graduierung_daten.php")).toHaveLength(2);
  });

  it("liest mindestens ein Mitglied, auch wenn das Budget schon vorbei ist", async () => {
    const { client } = clientMitAntworten((pfad) =>
      pfad === "/json/stilllegung_daten.php"
        ? new Response("[]", { status: 200 })
        : new Response("", { status: 200 })
    );
    const result = await client.extractStilllegungen(
      credentials,
      ["700001", "700002"],
      undefined,
      () => true
    );

    expect(result.records.map((record) => record.sourceId)).toEqual(["700001"]);
    expect(result.processedSourceIds).toEqual(["700001"]);
  });

  it("rotiert Graduierungen ueber eigene Zeitstempel statt ueber die Stammdaten", async () => {
    await seedMitgliederliste(["7801", "7802", "7803"], "2098-03-01T00:00:00.000Z");

    await expect(selectRotatingSourceIds(env.DB, "graduierungen", 10)).resolves.toEqual([
      "7801",
      "7802",
      "7803"
    ]);

    await markRotationRead(env.DB, "graduierungen", ["7801"], "2098-03-02T00:00:00.000Z");
    await markRotationRead(env.DB, "graduierungen", ["7803"], "2098-03-03T00:00:00.000Z");
    await expect(selectRotatingSourceIds(env.DB, "graduierungen", 10)).resolves.toEqual([
      "7802",
      "7801",
      "7803"
    ]);

    // Wer nicht mehr in der Mitgliederliste steht, faellt aus der Rotation.
    await env.DB.prepare(
      "INSERT INTO matool_detail_rotation (area, source_id, read_at) VALUES ('graduierungen', '9999', '2098-01-01T00:00:00.000Z')"
    ).run();
    await markRotationRead(env.DB, "graduierungen", ["7802"], "2098-03-04T00:00:00.000Z");
    const rest = await env.DB.prepare(
      "SELECT source_id FROM matool_detail_rotation WHERE area = 'graduierungen' ORDER BY source_id"
    ).all<{ source_id: string }>();
    expect(rest.results.map((row) => row.source_id)).toEqual(["7801", "7802", "7803"]);
  });

  it("gibt dem Graduierungsabruf ein Stoppsignal und merkt sich die gelesenen Mitglieder", async () => {
    await seedMitgliederliste(["7901", "7902"], "2098-04-01T00:00:00.000Z");
    let signal: (() => boolean) | undefined;
    let angefragt: readonly string[] = [];
    vi.spyOn(MatoolClient.prototype, "extractGraduierungen").mockImplementation(
      async (_credentials, sourceIds, _onProgress, shouldStop) => {
        signal = shouldStop;
        angefragt = sourceIds;
        return {
          area: "graduierungen",
          bodyBytes: 2,
          processedSourceIds: [sourceIds[0]!],
          records: [],
          rowCount: 0
        };
      }
    );

    const result = await collectMatoolSnapshots(
      testEnv,
      Date.parse("2098-04-01T08:00:00.000Z"),
      ["graduierungen"],
      "scheduled",
      { deadline: Date.now() + 10 * 60_000 }
    );

    expect(result).toMatchObject({ failed: 0, succeeded: 1 });
    expect(angefragt).toEqual(["7901", "7902"]);
    expect(signal).toBeTypeOf("function");
    expect(signal?.()).toBe(false);
    await expect(selectRotatingSourceIds(env.DB, "graduierungen", 10)).resolves.toEqual([
      "7902",
      "7901"
    ]);
  });

  it("beginnt keinen Bereich mehr, wenn das Budget aufgebraucht ist", async () => {
    const abruf = vi.spyOn(MatoolClient.prototype, "extractCheckins");

    const result = await collectMatoolSnapshots(
      testEnv,
      Date.parse("2098-04-02T08:00:00.000Z"),
      ["checkin", "graduierungen"],
      "scheduled",
      { deadline: Date.now() + 10_000 }
    );

    expect(abruf).not.toHaveBeenCalled();
    expect(result).toEqual({
      areas: [
        { area: "checkin", errorCode: "matool_time_budget_exhausted", status: "failed" },
        { area: "graduierungen", errorCode: "matool_time_budget_exhausted", status: "failed" }
      ],
      failed: 2,
      storedTotal: 0,
      succeeded: 0
    });
  });

  it("schliesst von Cloudflare abgebrochene Laeufe ab, laufende bleiben", async () => {
    await env.DB.prepare("DELETE FROM matool_sync_runs WHERE status = 'running'").run();
    const alt = await beginMatoolSyncRun(env.DB, {
      startedAt: "2098-05-01T10:00:00.000Z",
      trigger: "scheduled",
      scheduledFor: "2098-05-01T10:00:00.000Z"
    });
    const frisch = await beginMatoolSyncRun(env.DB, {
      startedAt: "2098-05-01T10:50:00.000Z",
      trigger: "manual"
    });

    await expect(
      markAbandonedMatoolSyncRuns(env.DB, "2098-05-01T11:00:00.000Z")
    ).resolves.toBe(1);

    const zeilen = await env.DB.prepare(
      "SELECT sync_id, status, error_code, finished_at FROM matool_sync_runs WHERE sync_id IN (?, ?)"
    ).bind(alt, frisch).all<{ error_code: string | null; finished_at: string | null; status: string; sync_id: string }>();
    const nachId = new Map(zeilen.results.map((zeile) => [zeile.sync_id, zeile]));
    expect(nachId.get(alt)).toMatchObject({
      status: "failed",
      error_code: "matool_run_aborted",
      finished_at: "2098-05-01T11:00:00.000Z"
    });
    expect(nachId.get(frisch)).toMatchObject({ status: "running", finished_at: null });
  });
});
