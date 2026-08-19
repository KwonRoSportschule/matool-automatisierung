import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import {
  MATOOL_INTERESSENTEN_DETAILS_PER_RUN,
  MATOOL_KLASSEN_RECORDS_PER_RUN,
  MATOOL_MAX_REQUESTS_PER_RUN,
  MATOOL_SNAPSHOT_AREAS,
  selectInteressentenDetailSourceIds,
  snapshotPayloadFields
} from "../src/worker/schedule";

describe("Snapshot-Feldallowlist", () => {
  it("ruft Interessenten und ihre Details vor dem anfragestarken Klassenbereich ab", () => {
    expect(MATOOL_SNAPSHOT_AREAS.slice(0, 3)).toEqual([
      "interessenten",
      "interessenten_details",
      "klassen"
    ]);
    expect(MATOOL_INTERESSENTEN_DETAILS_PER_RUN).toBe(500);
    expect(MATOOL_KLASSEN_RECORDS_PER_RUN).toBe(500);
    expect(MATOOL_MAX_REQUESTS_PER_RUN).toBe(2_500);
  });

  it("verwendet tatsaechlich vorkommende Felder deterministisch", () => {
    const first = snapshotPayloadFields([
      { payload: { email: "test@example.invalid", vorname: "Test" } },
      { payload: { status: "Termin", handy: "000" } }
    ]);
    const second = snapshotPayloadFields([
      { payload: { handy: "000", status: "Termin" } },
      { payload: { vorname: "Test", email: "test@example.invalid" } }
    ]);

    expect(first).toEqual(second);
    expect(first).toEqual([
      "columnCount",
      "tableIndex",
      "email",
      "handy",
      "status",
      "vorname"
    ]);
    expect(first).not.toContain("c63");
  });

  it("priorisiert fehlende Details und rotiert danach den aeltesten Bestand", async () => {
    const suffix = Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (value) => String(value % 10)
    ).join("");
    const missing = `1${suffix}01`;
    const oldest = `1${suffix}02`;
    const newest = `1${suffix}03`;
    const additionalMissing = ["04", "05", "06", "07"].map(
      (ending) => `1${suffix}${ending}`
    );
    // Layout-/Formularzeilen koennen technische Hash-IDs erzeugen. Vier
    // davon wuerden ohne SQL-Filter das gesamte LIMIT verbrauchen.
    const nonNumericLayoutIds = ["a", "b", "c", "d"].map(
      (ending) => `0000000000000000000000000000000${ending}`
    );
    const listRecords = [
      ...nonNumericLayoutIds,
      missing,
      ...additionalMissing,
      oldest,
      newest
    ].map((sourceId) => ({
      payload: { status: "SYNTHETISCH" },
      sourceId
    }));

    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["status"],
      area: "interessenten",
      finishedAt: "2098-01-01T00:00:01.000Z",
      observedAt: "2098-01-01T00:00:00.000Z",
      records: listRecords,
      runId: `selection_list_${suffix}`,
      startedAt: "2098-01-01T00:00:00.000Z"
    });
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["status"],
      area: "interessenten_details",
      finishedAt: "2098-01-02T00:00:01.000Z",
      observedAt: "2098-01-02T00:00:00.000Z",
      records: [{ payload: { status: "ALT" }, sourceId: oldest }],
      runId: `selection_old_${suffix}`,
      startedAt: "2098-01-02T00:00:00.000Z"
    });
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["status"],
      area: "interessenten_details",
      finishedAt: "2098-01-03T00:00:01.000Z",
      observedAt: "2098-01-03T00:00:00.000Z",
      records: [{ payload: { status: "NEU" }, sourceId: newest }],
      runId: `selection_new_${suffix}`,
      startedAt: "2098-01-03T00:00:00.000Z"
    });

    const selected = await selectInteressentenDetailSourceIds(env.DB);

    expect(selected).toEqual([
      missing,
      ...additionalMissing,
      oldest,
      newest
    ]);
  });

  it("ueberschreitet auch bei vielen gelieferten Feldern nie das Store-Limit", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 120 }, (_, index) => [
        `feld_${index.toString().padStart(3, "0")}`,
        String(index)
      ])
    );

    const fields = snapshotPayloadFields([{ payload }]);

    expect(fields).toHaveLength(80);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields.slice(0, 2)).toEqual(["columnCount", "tableIndex"]);
    expect(fields).toEqual([...fields.slice(0, 2), ...fields.slice(2).sort()]);
  });
});
