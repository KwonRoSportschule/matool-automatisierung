import { describe, expect, it } from "vitest";

import { loadExamListDataset } from "../src/exam-lists/data";
import {
  buildAllExamWorkbooksZip,
  buildExamWorkbook,
  type ExamListRow
} from "../src/exam-lists/xlsx";
import type { Env } from "../src/worker/env";

describe("Prüfungslisten", () => {
  it("erzeugt eine Excel-Datei mit genau drei Standort-Blättern", () => {
    const row: ExamListRow = {
      checkinsSinceLastExam: 4,
      currentGraduation: "WT 10 Kup",
      examOrder: 1,
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
      pendingMembers: 0,
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
        pendingMembers: 0,
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

  it("ordnet Kinder über die MATOOL-Sparten-ID zu, auch in mehrere Listen", async () => {
    const env = environment([
      ...member("710001", { schule: "273", spartenliste: ["4825", "193"] }),
      ...member("710002", { schule: "273", spartenliste: ["193"] }),
      ...member("710003", { schule: "1474", spartenliste: ["1017", "194"] }),
      // Name enthält "TK", ist aber TKD Jugend-Erwachsene -- früher landete
      // so jemand in der Tiger-Kids-Liste.
      graduation("710002", "1", "586", "9. Kup", "2026-01-10"),
      history("710001", []),
      history("710002", []),
      history("710003", [])
    ]);

    const dataset = await loadExamListDataset(env);
    expect(names(dataset, "warrior-tigers")).toEqual(["710001"]);
    expect(names(dataset, "tiger-kids")).toEqual(["710003"]);
    expect(names(dataset, "panda-kids")).toEqual(["710003"]);
    expect(dataset.rows.get("tiger-kids")?.[0]?.location).toBe("Stephanskirchen");
  });

  it("nimmt die höchste Graduierung der Sparte und zählt Check-ins danach", async () => {
    const env = environment([
      ...member("710001", { schule: "273", spartenliste: ["4825"] }),
      // Zwei Prüfungen am selben Tag, eine stornierte höhere und eine aus
      // einer anderen Sparte: maßgeblich ist der WT 6. Kup.
      graduation("710001", "1", "12079", "WT 7. Kup", "2026-03-01"),
      graduation("710001", "2", "12080", "WT 6. Kup", "2026-03-01"),
      graduation("710001", "3", "12081", "WT 5. Kup", "2026-04-01", true),
      graduation("710001", "4", "601", "TK Weißgurt", "2026-06-01"),
      history("710001", ["2026-02-28", "2026-03-01", "2026-03-02", "2026-09-30"])
    ]);

    const dataset = await loadExamListDataset(env);
    expect(dataset.rows.get("warrior-tigers")).toEqual([
      expect.objectContaining({
        checkinsRequired: 32,
        checkinsSinceLastExam: 2,
        currentGraduation: "WT 6. Kup",
        lastCheckinDate: "2026-09-30",
        lastExamDate: "2026-03-01",
        missingCheckins: 30,
        nextExam: "Prüfung zum 5. Kup"
      })
    ]);
  });

  it("wendet die Vorgaben je Programm an und zählt ohne Prüfung ab Vertragsbeginn", async () => {
    const env = environment([
      ...member("710001", {
        schule: "1734",
        spartenliste: ["1017"],
        vertragsbeginn: "01.09.2026"
      }),
      ...member("710002", { schule: "1734", spartenliste: ["194"] }),
      ...member("710003", { schule: "1734", spartenliste: ["4825"] }),
      history("710001", ["2026-08-31", "2026-09-01", "2026-09-08"]),
      graduation("710002", "1", "15639", "TK Grüngurt", "2026-05-01"),
      history("710002", ["2026-06-01"]),
      graduation("710003", "1", "12081", "WT 5. Kup", "2026-05-01"),
      history("710003", [])
    ]);

    const dataset = await loadExamListDataset(env);
    expect(dataset.rows.get("panda-kids")).toEqual([
      expect.objectContaining({
        checkinsRequired: 18,
        checkinsSinceLastExam: 2,
        currentGraduation: "Nicht vorhanden",
        lastExamDate: null,
        missingCheckins: 16,
        nextExam: "Prüfung zum PK Weißgurt"
      })
    ]);
    expect(dataset.rows.get("tiger-kids")).toEqual([
      expect.objectContaining({
        checkinsRequired: 12,
        missingCheckins: 11,
        nextExam: "Wechsel zu Warrior-Tigers"
      })
    ]);
    expect(dataset.rows.get("warrior-tigers")).toEqual([
      expect.objectContaining({ checkinsRequired: 32, nextExam: "Prüfung zum 4. Kup" })
    ]);
  });

  it("kennzeichnet einen noch nicht gelesenen Check-in-Verlauf und neue Mitglieder", async () => {
    const env = environment([
      ...member("710001", { schule: "273", spartenliste: ["4825"] }),
      snapshot("schueler", "710002", { name: "Member", vorname: "Pending" })
    ]);

    const dataset = await loadExamListDataset(env);
    expect(dataset.pendingMembers).toBe(1);
    expect(dataset.rows.get("warrior-tigers")).toEqual([
      expect.objectContaining({
        checkinsSinceLastExam: null,
        lastCheckinDate: null,
        missingCheckins: null
      })
    ]);
    const sheet = text(
      storedZipEntries(
        buildExamWorkbook({
          generatedAt: new Date("2026-10-07T08:00:00.000Z"),
          pendingMembers: dataset.pendingMembers,
          program: "warrior-tigers",
          rows: dataset.rows.get("warrior-tigers") ?? []
        })
      ).get("xl/worksheets/sheet1.xml")
    );
    expect(sheet).toContain("Historie wird noch geladen");
    expect(sheet).toContain("1 Mitglieder sind noch nicht eingelesen");
  });

  it("meldet einen unklaren Standort, statt ihn falsch zuzuordnen", async () => {
    const env = environment([...member("710001", { spartenliste: ["4825"] })]);

    const dataset = await loadExamListDataset(env);
    expect(dataset.unresolvedLocations.get("warrior-tigers")).toBe(1);
    expect(dataset.rows.get("warrior-tigers")).toEqual([]);
  });
});

function member(
  sourceId: string,
  detail: Record<string, unknown>
): { area: string; payload_json: string; source_id: string }[] {
  return [
    snapshot("schueler", sourceId, { name: `Member${sourceId}`, vorname: "Synthetic" }),
    snapshot("schueler_details", sourceId, {
      ...detail,
      spartenliste: JSON.stringify(detail.spartenliste ?? [])
    })
  ];
}

function graduation(
  memberId: string,
  recordId: string,
  graduationId: string,
  label: string,
  date: string,
  cancelled = false
): { area: string; payload_json: string; source_id: string } {
  return snapshot("graduierungen", `g_${memberId}_${recordId}`, {
    graduierung: label,
    graduierung_id: graduationId,
    mitglied_id: memberId,
    pruefungsdatum: date,
    sparte: "(Synthetic)",
    storniert: cancelled
  });
}

function history(
  memberId: string,
  dates: readonly string[]
): { area: string; payload_json: string; source_id: string } {
  return snapshot("checkin_historie", memberId, {
    anzahl: dates.length,
    checkin_daten: JSON.stringify(dates),
    letzter_checkin: dates[0] ?? null,
    mitglied_id: memberId
  });
}

function names(
  dataset: Awaited<ReturnType<typeof loadExamListDataset>>,
  program: "panda-kids" | "tiger-kids" | "warrior-tigers"
): string[] {
  return (dataset.rows.get(program) ?? []).map((row) =>
    row.lastName.replace("Member", "")
  );
}

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
