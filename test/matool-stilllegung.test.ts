import { describe, expect, it } from "vitest";

import { MatoolClient } from "../src/matool/client";
import { MatoolShapeMismatchError } from "../src/matool/response-shape";
import {
  parseStilllegungResponse,
  stilllegungenAusText,
  stilllegungsText
} from "../src/matool/stilllegung";

const encoder = new TextEncoder();

// Form wie die bestaetigte MATOOL-Antwort, Werte synthetisch.
function eintrag(
  satzId: string,
  von: [string, string],
  bis: [string, string],
  status = "aktiv"
): Record<string, unknown> {
  return {
    name: "Synthetische  Person ",
    satz_id: satzId,
    zahlungsperiode: "Monatsbeitrag",
    periodejanein: "0",
    von_monat: von[0],
    von_jahr: von[1],
    bis_monat: bis[0],
    bis_jahr: bis[1],
    status,
    periondenarray: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
  };
}

describe("MATOOL-Stilllegungen", () => {
  it("liest alle Zeitraeume eines Mitglieds, sortiert und ohne Namen", () => {
    const record = parseStilllegungResponse(
      encoder.encode(
        JSON.stringify([
          eintrag("800002", ["01", "2027"], ["02", "2027"]),
          eintrag("800001", ["10", "2026"], ["12", "2026"])
        ])
      ),
      "700001"
    );

    expect(record).toEqual({
      sourceId: "700001",
      payload: {
        anzahl: 2,
        mitglied_id: "700001",
        zeitraeume: "2026-10 bis 2026-12 (aktiv); 2027-01 bis 2027-02 (aktiv)"
      }
    });
    expect(JSON.stringify(record)).not.toContain("Synthetische");
  });

  it("liest den Formular-Eintrag eines Mitglieds ohne Stilllegung als leer", () => {
    // So antwortet MATOOL live (29.09.2026) fuer ein Mitglied ohne
    // Stilllegung: ein Eintrag ohne satz_id und ohne Zeitraum.
    const formular = {
      name: "Synthetische Person",
      zahlungsperiode: "Monatsbeitrag",
      status: "",
      periondenarray: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
    };
    expect(parseStilllegungResponse(encoder.encode(JSON.stringify([formular])), "700001")).toEqual({
      sourceId: "700001",
      payload: { anzahl: 0, mitglied_id: "700001", zeitraeume: "" }
    });

    // Neben einem echten Zeitraum, doppelt oder mit Zeitraumfeld bleibt er ein Fehler.
    for (const body of [
      [formular, eintrag("800001", ["10", "2026"], ["12", "2026"])],
      [formular, formular],
      [{ ...formular, von_monat: "10" }],
      [{ ...formular, unbekannt: "x" }]
    ]) {
      expect(() =>
        parseStilllegungResponse(encoder.encode(JSON.stringify(body)), "700001")
      ).toThrow(MatoolShapeMismatchError);
    }
  });

  it("legt auch ohne Stilllegung einen Datensatz an", () => {
    for (const body of ["[]", "", "null", "  "]) {
      expect(parseStilllegungResponse(encoder.encode(body), "700001")).toEqual({
        sourceId: "700001",
        payload: { anzahl: 0, mitglied_id: "700001", zeitraeume: "" }
      });
    }
  });

  it("nimmt eine Stilllegung ohne Ende als offen", () => {
    const record = parseStilllegungResponse(
      encoder.encode(JSON.stringify([eintrag("800001", ["3", "2026"], ["", ""], "Aktiv")])),
      "700001"
    );
    expect(record.payload.zeitraeume).toBe("2026-03 bis offen (aktiv)");
    expect(
      parseStilllegungResponse(
        encoder.encode(JSON.stringify([eintrag("800001", ["03", "2026"], ["00", "0000"])])),
        "700001"
      ).payload.zeitraeume
    ).toBe("2026-03 bis offen (aktiv)");
  });

  it("bricht bei unbestaetigter Form sicher ab", () => {
    const faelle: unknown[] = [
      { satz_id: "1" },
      [eintrag("800001", ["13", "2026"], ["12", "2026"])],
      [eintrag("800001", ["10", "26"], ["12", "2026"])],
      [eintrag("", ["10", "2026"], ["12", "2026"])],
      [eintrag("800001", ["10", "2026"], ["12", "2026"]), eintrag("800001", ["01", "2027"], ["02", "2027"])],
      [{ ...eintrag("800001", ["10", "2026"], ["12", "2026"]), status: 5 }],
      ["kein Objekt"]
    ];
    for (const fall of faelle) {
      expect(() =>
        parseStilllegungResponse(encoder.encode(JSON.stringify(fall)), "700001")
      ).toThrow(MatoolShapeMismatchError);
    }
    expect(() =>
      parseStilllegungResponse(encoder.encode("<html>Login</html>"), "700001")
    ).toThrow(/Stilllegungsdaten/u);
    expect(() => parseStilllegungResponse(encoder.encode("[]"), "abc")).toThrow(
      MatoolShapeMismatchError
    );
  });

  it("wandelt den gespeicherten Text verlustfrei zurueck", () => {
    const zeitraeume = [
      { von: "2026-10", bis: "2026-12", status: "aktiv" },
      { von: "2027-03", bis: "", status: "storniert" }
    ];
    expect(stilllegungenAusText(stilllegungsText(zeitraeume))).toEqual(zeitraeume);
    expect(stilllegungenAusText("")).toEqual([]);
    expect(stilllegungenAusText("2026-10 bis irgendwann (aktiv)")).toBeNull();
    expect(stilllegungenAusText(undefined)).toBeNull();
  });

  it("oeffnet das Mitglied, liest nur und schliesst es wieder", async () => {
    const calls: Array<{ body: string; method: string; path: string }> = [];
    const responses = [
      new Response("<html>Session</html>", { status: 200 }),
      new Response(null, { headers: { Location: "/index.php" }, status: 302 }),
      new Response("<html>Angemeldet</html>", { status: 200 }),
      new Response("", { status: 200 }),
      new Response(
        JSON.stringify([eintrag("800001", ["10", "2026"], ["12", "2026"])]),
        { headers: { "Content-Type": "text/html; charset=UTF-8" }, status: 200 }
      ),
      new Response("", { status: 200 })
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          body: init?.body instanceof URLSearchParams ? String(init.body) : ""
        });
        const response = responses.shift();
        if (!response) {
          throw new Error("Unerwartete Testanfrage");
        }
        return response;
      }) as typeof fetch
    );

    await expect(
      client.extractStilllegungen(
        { email: "service-account@example.invalid", password: "synthetic-password" },
        ["700001"]
      )
    ).resolves.toMatchObject({
      area: "schueler_stilllegungen",
      rowCount: 1,
      records: [
        {
          sourceId: "700001",
          payload: { anzahl: 1, zeitraeume: "2026-10 bis 2026-12 (aktiv)" }
        }
      ]
    });

    expect(calls.slice(3)).toEqual([
      {
        body: "schueler_open=700001&todo=open",
        method: "POST",
        path: "/json/session_schueler_open.php"
      },
      {
        body:
          "schueler_nr=700001&todo=undefined&satz_id=undefined" +
          "&stilllegung_von_monat=undefined&stilllegung_von_jahr=undefined" +
          "&stilllegung_bis_monat=undefined&stilllegung_bis_jahr=undefined" +
          "&zahlungsperiode_schueler=undefined" +
          "&stilllegung_von_monat_periode=undefined&stilllegung_von_jahr_periode=undefined" +
          "&show=schueler",
        method: "POST",
        path: "/json/stilllegung_daten.php"
      },
      {
        body: "schueler_open=700001&todo=close",
        method: "POST",
        path: "/json/session_schueler_open.php"
      }
    ]);
  });
});
