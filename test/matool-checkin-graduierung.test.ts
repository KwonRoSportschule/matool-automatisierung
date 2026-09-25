import { describe, expect, it } from "vitest";

import { parseCheckinPage } from "../src/matool/checkin";
import { MatoolClient } from "../src/matool/client";
import { parseGraduierungResponse } from "../src/matool/graduierung";

const encoder = new TextEncoder();

function checkinPage(monday: string): Uint8Array {
  return encoder.encode(`
    <html><body><script>
      namenliste_montag = "${monday}";
      namenliste_dienstag = "";
      namenliste_mittwoch = "";
      namenliste_donnerstag = "";
      namenliste_freitag = "";
      namenliste_samstag = "";
      namenliste_sonntag = "";
    </script></body></html>
  `);
}

describe("MATOOL Check-ins und Graduierungen", () => {
  it("liest nur tatsächliche Check-ins mit technischer Mitglieds- und Klassenkennung", () => {
    const records = parseCheckinPage(
      checkinPage(
        "<div id='700001-20260826182730-1340'></div><div id='700002-20260826183000-1340'></div><div id='700003-20260826000000-1340'></div>"
      )
    );

    expect(records).toEqual([
      {
        sourceId: "c_700001_20260826182730_1340",
        payload: {
          mitglied_id: "700001",
          klasse_id: "1340",
          checkin_datum: "2026-08-26",
          checkin_uhrzeit: "18:27:30",
          checkin_zeitpunkt: "2026-08-26T18:27:30"
        }
      },
      {
        sourceId: "c_700002_20260826183000_1340",
        payload: {
          mitglied_id: "700002",
          klasse_id: "1340",
          checkin_datum: "2026-08-26",
          checkin_uhrzeit: "18:30:00",
          checkin_zeitpunkt: "2026-08-26T18:30:00"
        }
      }
    ]);
  });

  it("bricht bei einer unvollständigen Check-in-Wochenansicht sicher ab", () => {
    expect(() =>
      parseCheckinPage(
        encoder.encode('<script>namenliste_montag = "";</script>')
      )
    ).toThrow(/Check-in-Ansicht/u);
  });

  it("extrahiert Prüfungs-Historie und bewahrt den Storno-Status", () => {
    const records = parseGraduierungResponse(
      encoder.encode(
        JSON.stringify([
          { datum: "sparte", id: "123" },
          {
            id: "800001",
            datum: "26.08.2026",
            graduierungid: "15359",
            graduierung: "Gelb",
            sparte: "Kickboxen",
            link_pdf: "&nbsp;",
            storno: "0"
          },
          {
            id: "800002",
            datum: "27.08.2026",
            graduierungid: "15360",
            graduierung: "Orange",
            sparte: "Kickboxen",
            link_pdf: "https://core.matool.de/geschuetzt.pdf",
            storno: 1
          }
        ])
      ),
      "700001"
    );

    expect(records).toEqual([
      {
        sourceId: "g_700001_800001",
        payload: {
          mitglied_id: "700001",
          graduierung_id: "15359",
          pruefungsdatum: "2026-08-26",
          graduierung: "Gelb",
          sparte: "Kickboxen",
          storniert: false,
          pdf_verfuegbar: false
        }
      },
      {
        sourceId: "g_700001_800002",
        payload: {
          mitglied_id: "700001",
          graduierung_id: "15360",
          pruefungsdatum: "2026-08-27",
          graduierung: "Orange",
          sparte: "Kickboxen",
          storniert: true,
          pdf_verfuegbar: true
        }
      }
    ]);
  });

  it("bricht bei unbestätigtem Prüfungs-Schema sicher ab", () => {
    expect(() =>
      parseGraduierungResponse(
        encoder.encode(
          JSON.stringify([
            {
              id: "800001",
              datum: "26.08.2026",
              graduierungid: "15359",
              graduierung: "Gelb",
              sparte: "Kickboxen",
              link_pdf: "&nbsp;",
              storno: "unbekannt"
            }
          ])
        ),
        "700001"
      )
    ).toThrow(/Graduierungsdaten/u);
  });

  it("liest Check-ins und Graduierungen ausschließlich über die bestätigten Lese-Endpunkte", async () => {
    const calls: Array<{ body: string; method: string; path: string }> = [];
    const responses = [
      new Response("<html>Session</html>", { status: 200 }),
      new Response(null, { headers: { Location: "/index.php" }, status: 302 }),
      new Response("<html>Angemeldet</html>", { status: 200 }),
      new Response(
        checkinPage("<div id='700001-20260826182730-1340'></div>"),
        { headers: { "Content-Type": "text/html" }, status: 200 }
      ),
      new Response(
        JSON.stringify([
          {
            id: "800001",
            datum: "26.08.2026",
            graduierungid: "15359",
            graduierung: "Gelb",
            sparte: "Kickboxen",
            link_pdf: "&nbsp;",
            storno: 0
          }
        ]),
        { headers: { "Content-Type": "application/json" }, status: 200 }
      )
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
    const credentials = {
      email: "service-account@example.invalid",
      password: "synthetic-password"
    };

    await expect(client.extractCheckins(credentials)).resolves.toMatchObject({
      area: "checkin",
      rowCount: 1
    });
    await expect(
      client.extractGraduierungen(credentials, ["700001"])
    ).resolves.toMatchObject({ area: "graduierungen", rowCount: 1 });

    expect(calls.map(({ body, method, path }) => ({ body, method, path }))).toEqual([
      { body: "", method: "GET", path: "/index.php" },
      {
        body: "mail=service-account%40example.invalid&pass=synthetic-password",
        method: "POST",
        path: "/index.php"
      },
      { body: "", method: "GET", path: "/index.php" },
      { body: "", method: "GET", path: "/index.php?show=checkin" },
      {
        body: "schueler_nr=700001",
        method: "POST",
        path: "/json/graduierung_daten.php"
      }
    ]);
  });
});
