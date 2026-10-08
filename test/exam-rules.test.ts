import { describe, expect, it } from "vitest";

import { EXAM_PROGRAM_RULES } from "../src/exam-lists/data";

describe("Check-in-Vorgaben der Prüfungslisten", () => {
  it("hält die WT-Staffel je Prüfung fest", () => {
    const wt = EXAM_PROGRAM_RULES["warrior-tigers"];
    // Schlüssel: Prüfung zum …; Index der aktuellen Graduierung, null = ohne.
    const proPruefung = {
      "10. Kup": wt.requiredCheckins(null),
      "9. Kup": wt.requiredCheckins(0),
      "8. Kup": wt.requiredCheckins(1),
      "7. Kup": wt.requiredCheckins(2),
      "6. Kup": wt.requiredCheckins(3),
      "5. Kup": wt.requiredCheckins(4),
      "4. Kup": wt.requiredCheckins(5),
      "3. Kup": wt.requiredCheckins(6),
      "2. Kup": wt.requiredCheckins(7),
      "1. Kup": wt.requiredCheckins(8),
      "TKD Jugend-Erwachsene": wt.requiredCheckins(9)
    };
    expect(proPruefung).toEqual({
      "10. Kup": 12,
      "9. Kup": 12,
      "8. Kup": 12,
      "7. Kup": 12,
      "6. Kup": 12,
      "5. Kup": 32,
      "4. Kup": 32,
      "3. Kup": 36,
      "2. Kup": 36,
      "1. Kup": 36,
      "TKD Jugend-Erwachsene": 36
    });
  });

  it("verlangt bei Panda-Kids 18 und bei Tiger-Kids 12 Check-ins je Gurt", () => {
    for (const index of [null, 0, 3, 7]) {
      expect(EXAM_PROGRAM_RULES["panda-kids"].requiredCheckins(index)).toBe(18);
      expect(EXAM_PROGRAM_RULES["tiger-kids"].requiredCheckins(index)).toBe(12);
    }
  });
});
