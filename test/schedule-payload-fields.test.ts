import { describe, expect, it } from "vitest";

import { snapshotPayloadFields } from "../src/worker/schedule";

describe("Snapshot-Feldallowlist", () => {
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
