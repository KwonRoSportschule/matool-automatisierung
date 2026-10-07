import { describe, expect, it } from "vitest";

import { loadExamListDataset } from "../src/exam-lists/data";
import {
  buildAllExamWorkbooksZip,
  buildExamWorkbook,
  type ExamListRow
} from "../src/exam-lists/xlsx";
import type { MatoolSafeAreaRecord } from "../src/matool/client";
import type { Env } from "../src/worker/env";

describe("Prüfungslisten", () => {
  it("erzeugt eine Excel-Datei mit genau drei Standort-Blättern", () => {
    const row: ExamListRow = {
      checkinsSinceLastExam: 4,
      currentGraduation: "WT 10 Kup",
      firstName: "Synthetic",
      lastCheckinDate: "2026-09-01",
      lastExamDate: "2026-03-01",
      lastName: "Member",
      location: "Rosenheim",
      checkinsRequired: 12,
      missingCheckins: 8,
      nextExam: "Prüfung zum 9. Kup"
    };
    const bytes = buildExamWorkbook({
      generatedAt: new Date("2026-10-06T08:00:00.000Z"),
      incompleteCheckinHistory: true,
      program: "warrior-tigers",
      rows: [row]
    });
    const files = storedZipEntries(bytes);

    expect([...files.keys()].sort()).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
        "xl/worksheets/sheet3.xml"
      ])
    );
    expect(text(files.get("xl/workbook.xml"))).toContain(
      '<sheet name="Rosenheim"'
    );
    expect(text(files.get("xl/workbook.xml"))).toContain(
      '<sheet name="Stephanskirchen"'
    );
    expect(text(files.get("xl/workbook.xml"))).toContain(
      '<sheet name="Raubling"'
    );
    const rosenheim = text(files.get("xl/worksheets/sheet1.xml"));
    expect(rosenheim).toContain("Prüfung zum 9. Kup");
    expect(rosenheim).toContain("NOCH FEHLENDE CHECK-INS");
    expect(rosenheim).toContain("LETZTER CHECK-IN");
    expect(rosenheim).toContain("FITNESSTEST TEILGENOMMEN AM");
    expect(rosenheim).not.toContain("PRIVATE");
  });

  it("packt alle drei Programmdateien in einen gemeinsamen ZIP-Download", () => {
    const generatedAt = new Date("2026-10-06T08:00:00.000Z");
    const workbook = (program: "panda-kids" | "tiger-kids" | "warrior-tigers") =>
      buildExamWorkbook({
        generatedAt,
        incompleteCheckinHistory: true,
        program,
        rows: []
      });
    const zip = buildAllExamWorkbooksZip(
      new Map([
        ["panda-kids", workbook("panda-kids")],
        ["tiger-kids", workbook("tiger-kids")],
        ["warrior-tigers", workbook("warrior-tigers")]
      ]),
      generatedAt
    );
    expect([...storedZipEntries(zip).keys()].sort()).toEqual([
      "Panda_Kids_Pruefungsliste.xlsx",
      "Tiger_Kids_Pruefungsliste.xlsx",
      "Warrior_Tigers_Pruefungsliste.xlsx"
    ]);
  });

  it("wendet die WT-Check-in-Regel an und ermittelt den letzten Check-in", async () => {
    const live: MatoolSafeAreaRecord[] = [
      {
        payload: {
          name: "Member",
          vorname: "Synthetic"
        },
        sourceId: "710001"
      }
    ];
    const env = environment([
      snapshot("schueler", "710001", { name: "Member", vorname: "Synthetic" }),
      snapshot("schueler_details", "710001", {
        klassenliste: JSON.stringify([{ name: "Rosenheim Kinder" }]),
        spartenliste: JSON.stringify([{ name: "Warrior-Tigers" }])
      }),
      snapshot("graduierungen", "g_710001_1", {
        graduierung: "WT 10 Kup",
        mitglied_id: "710001",
        pruefungsdatum: "2026-03-01",
        sparte: "Warrior-Tigers",
        storniert: false
      }),
      snapshot("checkin", "c_710001_1", {
        checkin_datum: "2026-09-01",
        mitglied_id: "710001"
      })
    ]);

    const dataset = await loadExamListDataset(env, live);
    expect(dataset.rows.get("warrior-tigers")).toEqual([
      expect.objectContaining({
        checkinsSinceLastExam: 1,
        checkinsRequired: 12,
        currentGraduation: "WT 10 Kup",
        lastCheckinDate: "2026-09-01",
        location: "Rosenheim",
        missingCheckins: 11,
        nextExam: "Prüfung zum 9. Kup"
      })
    ]);
  });

  it("meldet einen unklaren Standort, statt ihn falsch zuzuordnen", async () => {
    const live: MatoolSafeAreaRecord[] = [
      { payload: { name: "Member", vorname: "Synthetic" }, sourceId: "710001" }
    ];
    const env = environment([
      snapshot("schueler", "710001", { name: "Member", vorname: "Synthetic" }),
      snapshot("schueler_details", "710001", {
        spartenliste: JSON.stringify([{ name: "Warrior-Tigers" }])
      })
    ]);

    const dataset = await loadExamListDataset(env, live);
    expect(dataset.unresolvedLocations.get("warrior-tigers")).toBe(1);
    expect(dataset.rows.get("warrior-tigers")).toEqual([]);
  });
});

function snapshot(
  area: string,
  sourceId: string,
  payload: Record<string, unknown>
): { area: string; payload_json: string; source_id: string } {
  return { area, payload_json: JSON.stringify(payload), source_id: sourceId };
}

function environment(
  rows: readonly { area: string; payload_json: string; source_id: string }[]
): Env {
  return {
    APP_ENV: "test",
    DATA_ENCRYPTION_REQUIRED: "false",
    DB: {
      prepare() {
        return {
          all: async () => ({ results: [...rows], success: true })
        };
      }
    } as unknown as D1Database
  } as Env;
}

function text(value: Uint8Array | undefined): string {
  if (!value) {
    throw new Error("missing synthetic zip entry");
  }
  return new TextDecoder().decode(value);
}

function storedZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x04034b50) {
      break;
    }
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const size = view.getUint32(18, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(
      bytes.slice(nameStart, nameStart + nameLength)
    );
    files.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}
