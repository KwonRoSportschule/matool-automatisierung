import { describe, expect, it } from "vitest";

import { parseCheckinHistorieResponse } from "../src/matool/checkin-historie";

const encoder = new TextEncoder();

function body(entries: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(entries));
}

describe("MATOOL Check-in-Verlauf", () => {
  it("übernimmt nur die Daten, zählt nachgetragene Check-ins mit und sortiert absteigend", () => {
    const record = parseCheckinHistorieResponse(
      body([
        { id: "9001", klasse: "Synthetic", name: "Synthetic ", timestamp: "06.12.2017 - 18:30:48", wochentag: "Mittwoch" },
        { id: "9002", klasse: "", name: "Synthetic ", timestamp: "30.09.2026 - 00:00:00", wochentag: "Mittwoch" },
        { id: "9003", klasse: "Synthetic", name: "Synthetic ", timestamp: "30.09.2026 - 17:00:00", wochentag: "Mittwoch" }
      ]),
      "710001"
    );

    expect(record).toEqual({
      payload: {
        anzahl: 3,
        checkin_daten: JSON.stringify(["2026-09-30", "2026-09-30", "2017-12-06"]),
        letzter_checkin: "2026-09-30",
        mitglied_id: "710001"
      },
      sourceId: "710001"
    });
    expect(JSON.stringify(record)).not.toContain("Synthetic");
  });

  it("speichert auch einen leeren Verlauf als eigenen Datensatz", () => {
    expect(parseCheckinHistorieResponse(body([]), "710001").payload).toEqual({
      anzahl: 0,
      checkin_daten: "[]",
      letzter_checkin: null,
      mitglied_id: "710001"
    });
  });

  it.each([
    ["kein Array", { id: "1" }],
    ["unbekanntes Feld", [{ id: "1", timestamp: "30.09.2026 - 17:00:00", extra: "x" }]],
    ["ungültiges Datum", [{ id: "1", timestamp: "31.02.2026 - 17:00:00" }]],
    ["doppelte Kennung", [
      { id: "1", timestamp: "30.09.2026 - 17:00:00" },
      { id: "1", timestamp: "01.10.2026 - 17:00:00" }
    ]]
  ])("lehnt eine abweichende Antwort ab (%s)", (_label, entries) => {
    expect(() => parseCheckinHistorieResponse(body(entries), "710001")).toThrow(
      expect.objectContaining({ code: "matool_checkin_historie_schema_mismatch" })
    );
  });
});
