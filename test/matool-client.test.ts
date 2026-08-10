import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import {
  assertAllowedMatoolUrl,
  MatoolClient,
  validateMatoolBaseUrl
} from "../src/matool/client";

function clientForInteressentenPage(page: string): MatoolClient {
  const responses = [
    new Response("<html><body>Session</body></html>", {
      headers: {
        "Content-Type": "text/html",
        "Set-Cookie":
          "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
      },
      status: 200
    }),
    new Response(null, {
      headers: { Location: "/index.php" },
      status: 302
    }),
    new Response("<html><body>Angemeldet</body></html>", {
      headers: { "Content-Type": "text/html" },
      status: 200
    }),
    new Response(page, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 200
    })
  ];
  return new MatoolClient(
    "https://core.matool.de",
    (async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected synthetic request");
      }
      return response;
    }) as typeof fetch
  );
}

function klassenDetailResponse(
  sourceId: string,
  overrides: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify([
      {
        alter_ende: "99",
        alter_start: "1",
        benutzer: "1000",
        beschreibung: "Synthetic class",
        bildDa: null,
        endzeit_h: "20",
        endzeit_m: "00",
        freiklasse: "0",
        id: sourceId,
        id_schulintern: "1",
        kapazitaet: "20",
        klassenende: "2030-12-31",
        klassenfarbe: "abcdef",
        klassenstart: "2026-01-01",
        kurzname: "Synthetic",
        liveLink: "PRIVATE-LIVE-LINK",
        online: "0",
        probetraining_kontingent: "2",
        raum: "1",
        schueler_liste_sms: "PRIVATE-SMS-LIST",
        schuelerliste: [{ private: "PRIVATE-STUDENT" }],
        schule: "1",
        sms30: "0",
        sms30Text: "PRIVATE-SMS-TEXT",
        sparte: "1",
        startzeit_h: "19",
        startzeit_m: "00",
        teilnehmerMax: "20",
        wochentag: "1",
        ...overrides
      }
    ]),
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 200
    }
  );
}

function interessentenPage(
  rows: string,
  headers = ["Nr.", "Datum", "Vorname", "Name", "Status"]
): string {
  return `
    <html>
      <body>
        <h1>Interessenten</h1>
        <table class="master_tab">
          <tr class="master_tab_tr_head">
            ${headers.map((header) => `<td>${header}</td>`).join("")}
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `;
}

function interessentRow(input: {
  createdDate: string;
  displayNumber: string;
  firstName: string;
  lastName: string;
  linkId?: string;
  sourceId: string;
  status: string;
}): string {
  return `
    <tr onclick="formular_fuellen(${input.sourceId})">
      <td>
        <a href="/index.php?show=schueler&amp;todo=3&amp;interessent=${input.linkId ?? input.sourceId}">
          ${input.displayNumber}
        </a>
      </td>
      <td>${input.createdDate}</td>
      <td>${input.firstName}</td>
      <td>${input.lastName}</td>
      <td>${input.status}</td>
    </tr>
  `;
}

describe("MATOOL-Ausgangs-Host-Allowlist", () => {
  it("akzeptiert ausschließlich die verifizierte HTTPS-Basisadresse", () => {
    expect(validateMatoolBaseUrl("https://core.matool.de").origin).toBe(
      "https://core.matool.de"
    );
  });

  it.each([
    "http://core.matool.de",
    "https://core.matool.de.attacker.invalid",
    "https://user:pass@core.matool.de",
    "https://core.matool.de:8443"
  ])("blockiert %s", (value) => {
    expect(() => validateMatoolBaseUrl(value)).toThrow(AppError);
  });

  it("blockiert einen Redirect zu einem fremden Host", () => {
    expect(() =>
      assertAllowedMatoolUrl(
        new URL("https://attacker.invalid/index.php")
      )
    ).toThrowError(
      expect.objectContaining({
        code: "matool_redirect_blocked"
      })
    );
  });

  it("führt Login und Interessenten-Probe in genau einer Lauf-Session aus", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const responses = [
      new Response("<html><body>Session vorbereiten</body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie":
            "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
        },
        status: 200
      }),
      new Response(null, {
        headers: {
          Location: "/index.php",
        },
        status: 302
      }),
      new Response("<html><body>Angemeldete Oberfläche</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      }),
      new Response(
        "<html><body><h1>Interessenten</h1><table><tr></tr><tr></tr></table></body></html>",
        {
          headers: { "Content-Type": "text/html" },
          status: 200
        }
      )
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ ...(init ? { init } : {}), url: String(input) });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    const result = await client.probeInteressenten({
      email: "service-account@example.invalid",
      password: "synthetic-password"
    });

    expect(requests).toHaveLength(4);
    expect(requests.every(({ url }) => url.startsWith("https://core.matool.de/"))).toBe(
      true
    );
    expect(
      new Headers(requests[1]?.init?.headers).get("Cookie")
    ).toBe("synthetic_session=opaque-test-value");
    expect(result.rowMarkerCount).toBe(2);
    expect(result.loginFormDetected).toBe(false);
    expect(result.interestMarkerDetected).toBe(true);
  });

  it("erkennt nur aggregierte Interessenten-Struktur in sicherer Request-Reihenfolge", async () => {
    const page = `
      <html>
        <body>
          <h1>Interessenten</h1>
          <table id="lead-table-4711">
            <tr><th>Vorname</th><th><span>E-Mail</span></th></tr>
            <tr id="lead-900001" onclick="openLead(900001, 'ALICE-ID-SECRET')">
              <td>PRIVATE CELL ALICE</td>
              <td>
                private-alice@example.invalid
                <a href="/index.php?show=interessenten&id=900001&token=PRIVATE-TOKEN">Details</a>
                <input name="follow_up_900001" type="date" value="PRIVATE-DATE">
                <select name="status">
                  <option value="PRIVATE-OPTION-A">Privat A</option>
                  <option value="PRIVATE-OPTION-B">Privat B</option>
                </select>
              </td>
            </tr>
            <tr id="lead-900002" onclick="openLead(900002, 'BOB-ID-SECRET')">
              <td>PRIVATE CELL BOB</td>
              <td>
                <a href="/index.php?show=interessenten&id=900002&token=ANOTHER-TOKEN">Details</a>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const responses = [
      new Response("<html><body>Session</body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie":
            "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
        },
        status: 200
      }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      }),
      new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200
      })
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ ...(init ? { init } : {}), url: String(input) });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    const result = await client.discoverStructure(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(
      requests.map(({ init, url }) => [
        init?.method,
        `${new URL(url).pathname}${new URL(url).search}`
      ])
    ).toEqual([
      ["GET", "/index.php"],
      ["POST", "/index.php"],
      ["GET", "/index.php"],
      ["GET", "/index.php?show=interessenten"]
    ]);
    expect(result).toMatchObject({
      bereich: "interessenten",
      bodyBytes: new TextEncoder().encode(page).byteLength,
      rowCount: 3,
      status: 200,
      tableCount: 1,
      tables: [
        {
          headers: ["Vorname", "E-Mail"],
          index: 0,
          rowCount: 3
        }
      ],
      fields: [
        {
          element: "input",
          name: "follow_up_{number}",
          type: "date"
        },
        {
          element: "select",
          name: "status",
          optionCount: 2
        }
      ]
    });
    expect(result.idPatterns).toEqual(
      expect.arrayContaining([
        {
          attribute: "id",
          occurrences: 2,
          pattern: "lead-{number}"
        },
        {
          attribute: "onclick",
          occurrences: 2,
          pattern: "openLead({number},{string})"
        },
        {
          attribute: "href",
          occurrences: 2,
          pattern:
            "/index.php?show={value}&id={number}&token={value}"
        }
      ])
    );

    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "4711",
      "900001",
      "900002",
      "ALICE-ID-SECRET",
      "BOB-ID-SECRET",
      "PRIVATE CELL ALICE",
      "PRIVATE CELL BOB",
      "private-alice@example.invalid",
      "PRIVATE-TOKEN",
      "ANOTHER-TOKEN",
      "PRIVATE-DATE",
      "PRIVATE-OPTION-A",
      "PRIVATE-OPTION-B",
      "Privat A",
      "Privat B"
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("blockiert nicht freigegebene Bereiche vor jedem Netzwerkzugriff", async () => {
    let requestCount = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        requestCount += 1;
        throw new Error("network must not be reached");
      }) as typeof fetch
    );

    await expect(
      client.discoverStructure(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "schueler"
      )
    ).rejects.toMatchObject({
      code: "matool_area_not_allowed"
    });
    expect(requestCount).toBe(0);
  });

  it("extrahiert ausschliesslich das freigegebene Interessenten-Schema", async () => {
    const page = interessentenPage(
      interessentRow({
        createdDate: "29.07.2026",
        displayNumber: "4711",
        firstName: "Alice",
        lastName: "Beispiel",
        sourceId: "900001",
        status: "Probetraining"
      }) +
        interessentRow({
          createdDate: "30.07.2026",
          displayNumber: "4712",
          firstName: "Bob",
          lastName: "Muster",
          sourceId: "900002",
          status: "Neu"
        })
    );

    await expect(
      clientForInteressentenPage(page).extractInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).resolves.toEqual([
      {
        sourceId: "900001",
        displayNumber: "4711",
        createdDate: "29.07.2026",
        firstName: "Alice",
        lastName: "Beispiel",
        status: "Probetraining"
      },
      {
        sourceId: "900002",
        displayNumber: "4712",
        createdDate: "30.07.2026",
        firstName: "Bob",
        lastName: "Muster",
        status: "Neu"
      }
    ]);
  });

  it("verwendet die interne Interessenten-ID stabil statt der sichtbaren Nummer", async () => {
    const credentials = {
      email: "service-account@example.invalid",
      password: "synthetic-password"
    };
    const firstPage = interessentenPage(
      interessentRow({
        createdDate: "29.07.2026",
        displayNumber: "12",
        firstName: "Alice",
        lastName: "Beispiel",
        sourceId: "987654",
        status: "Neu"
      })
    );
    const secondPage = interessentenPage(
      interessentRow({
        createdDate: "29.07.2026",
        displayNumber: "999",
        firstName: "Alice",
        lastName: "Beispiel",
        sourceId: "987654",
        status: "Neu"
      })
    );

    const first = await clientForInteressentenPage(
      firstPage
    ).extractInteressenten(credentials);
    const second = await clientForInteressentenPage(
      secondPage
    ).extractInteressenten(credentials);

    expect(first[0]?.sourceId).toBe("987654");
    expect(second[0]?.sourceId).toBe(first[0]?.sourceId);
    expect(second[0]?.displayNumber).not.toBe(first[0]?.displayNumber);
  });

  it("bricht bei ID-Mismatch ohne Teilresultat oder PII in der Fehlermeldung ab", async () => {
    const privateValues = [
      "PRIVATE-FIRST-NAME",
      "PRIVATE-LAST-NAME",
      "private-person@example.invalid"
    ];
    const page = interessentenPage(
      interessentRow({
        createdDate: "private-person@example.invalid",
        displayNumber: "4711",
        firstName: "PRIVATE-FIRST-NAME",
        lastName: "PRIVATE-LAST-NAME",
        linkId: "900099",
        sourceId: "900001",
        status: "PRIVATE-STATUS"
      })
    );

    let failure: unknown;
    try {
      await clientForInteressentenPage(page).extractInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "matool_interessenten_schema_mismatch",
      status: 502
    });
    const serializedFailure = JSON.stringify(failure, [
      "name",
      "message",
      "code",
      "status"
    ]);
    for (const privateValue of privateValues) {
      expect(serializedFailure).not.toContain(privateValue);
    }
  });

  it("liest Interessenten-Details lesend und schreibt nichts zurueck", async () => {
    const listPage = `
      <html><body><h1>Interessenten</h1>
        <table>
          <tr class="master_tab_tr_head"><td>Nr.</td><td>Vorname</td></tr>
          <tr onclick="formular_fuellen(606578)"><td>5336</td><td>Lilli</td></tr>
        </table>
      </body></html>
    `;
    const detailPage = `
      <html><body><h1>Interessenten</h1>
        <form>
          <input type="hidden" name="id" value="606578" />
          <input type="hidden" name="todo" value="2" />
          <input name="vorname" value="Lilli" />
          <input name="email" value="lilli@example.invalid" />
          <input name="handy" value="0170 1234567" />
          <input name="probetraining" value="12.08.2026" />
          <input name="probetraining_zeit" value="17:30" />
          <input name="text" value="GEHEIME NOTIZ" />
          <input type="password" name="pass" value="GEHEIM" />
          <select name="status">
            <option value="Offen">Offen</option>
            <option value="Termin" selected>Termin</option>
          </select>
        </form>
      </body></html>
    `;

    const calls: Array<{ body: string; url: string }> = [];
    const fetchImplementation = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body =
        init?.body instanceof URLSearchParams ? init.body.toString() : "";
      calls.push({ body, url });
      if (url.includes("session_interessenten_open.php")) {
        return new Response("", { status: 200 });
      }
      if (url.endsWith("/index.php") && init?.method === "POST") {
        return new Response(null, {
          headers: { Location: "/index.php" },
          status: 302
        });
      }
      const page = calls.filter((c) => c.url.includes("show=interessenten"))
        .length > 1
        ? detailPage
        : listPage;
      return new Response(
        url.includes("show=interessenten") ? page : "<html><body>Angemeldet</body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
      );
    }) as typeof fetch;

    const client = new MatoolClient(
      "https://core.matool.de",
      fetchImplementation
    );
    const result = await client.extractInteressentenDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      5
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sourceId).toBe("606578");
    expect(result.records[0]?.payload).toMatchObject({
      email: "lilli@example.invalid",
      handy: "0170 1234567",
      probetraining: "12.08.2026",
      probetraining_zeit: "17:30",
      status: "Termin",
      vorname: "Lilli"
    });

    // Freitext und Passwortfelder werden nicht uebernommen.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("GEHEIME NOTIZ");
    expect(serialized).not.toContain("GEHEIM");

    // Der Datensatz wird geoeffnet und wieder geschlossen.
    const sessionCalls = calls.filter((c) =>
      c.url.includes("session_interessenten_open.php")
    );
    expect(sessionCalls.map((c) => c.body)).toEqual([
      "interessenten_open=606578&todo=open",
      "interessenten_open=606578&todo=close"
    ]);

    // Es darf kein Speichern-Formular an MATOOL gehen.
    const writeCalls = calls.filter((c) => c.body.includes("todo=2"));
    expect(writeCalls).toEqual([]);
  });

  it("erkennt MATOOLs Kopfzeile an der Klasse master_tab_tr_head", async () => {
    const page = `
      <html><body><h1>Interessenten</h1>
        <table>
          <tr class="master_tab_tr_head"><td>Nr.</td><td>Datum</td><td>Vorname</td><td>Name</td><td>Status</td></tr>
        </table>
        <table>
          <tr onclick="formular_fuellen(5304)">
            <td>5304</td><td>11.07.2026</td><td>Laura</td><td>Beispiel</td><td>Termin</td>
          </tr>
        </table>
      </body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    // Die Kopfzeile selbst wird nicht als Datensatz gespeichert.
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.payload).toEqual({
      nr: "5304",
      datum: "11.07.2026",
      vorname: "Laura",
      name: "Beispiel",
      status: "Termin",
      columnCount: 5,
      tableIndex: 1
    });
  });

  it("benennt Spalten nach der Kopfzeile, auch wenn sie in einer eigenen Tabelle steht", async () => {
    const page = `
      <html><body><h1>Interessenten</h1>
        <table><tr><th>Nr.</th><th>Datum</th><th>Vorname</th><th>Name</th><th>Status</th></tr></table>
        <table>
          <tr onclick="formular_fuellen(5304)">
            <td>5304</td><td>11.07.2026</td><td>Laura</td><td>Beispiel</td><td>Termin</td>
          </tr>
        </table>
      </body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(result.records[0]?.payload).toEqual({
      nr: "5304",
      datum: "11.07.2026",
      vorname: "Laura",
      name: "Beispiel",
      status: "Termin",
      columnCount: 5,
      tableIndex: 1
    });
  });

  it("behaelt die Nummerierung, wenn zwei Kopfzeilen derselben Breite widersprechen", async () => {
    const page = `
      <html><body><h1>Interessenten</h1>
        <table><tr><th>Nr.</th><th>Datum</th></tr></table>
        <table><tr><th>Kurs</th><th>Raum</th></tr></table>
        <table>
          <tr onclick="formular_fuellen(4711)"><td>4711</td><td>01.01.2026</td></tr>
        </table>
      </body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(result.records[0]?.payload).toMatchObject({
      c00: "4711",
      c01: "01.01.2026"
    });
  });

  it("extrahiert allowlist-basierte Tabellenzeilen mit stabilen IDs und Redaction", async () => {
    const longCell = "x".repeat(700);
    const page = `
      <html><body><h1>Interessenten</h1>
        <table>
          <tr><th>Name</th><th>Details</th><th>Zahlung</th></tr>
          <tr onclick="formular_fuellen(900001)">
            <td>Alice<script>PRIVATE-SCRIPT</script>
              <input value="PRIVATE-INPUT"><img alt="PRIVATE-IMAGE">
            </td>
            <td><a href="/index.php?show=interessenten&amp;interessent=900001">Öffnen</a></td>
            <td>DE89 3704 0044 0532 0130 00</td>
          </tr>
          <tr onclick="formular_fuellen(900001)">
            <td>Duplikat</td><td>Duplikat</td><td>Duplikat</td>
          </tr>
          <tr><td><a href="/index.php?show=interessenten&amp;page=2">Weiter</a></td></tr>
          <tr><td>${longCell}</td><td>Ohne technische ID</td></tr>
        </table>
      </body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(result).toMatchObject({
      area: "interessenten",
      bodyBytes: new TextEncoder().encode(page).byteLength,
      rowCount: 2
    });
    // Die Spaltennamen stammen aus der Kopfzeile der Tabelle.
    expect(result.records[0]).toEqual({
      sourceId: "900001",
      payload: {
        name: "Alice",
        details: "Öffnen",
        zahlung: "",
        columnCount: 3,
        tableIndex: 0
      }
    });
    // Fuer zwei Spalten gibt es keine passende Kopfzeile; dann bleibt die
    // Nummerierung erhalten.
    expect(result.records[1]?.sourceId).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.records[1]?.payload.c00).toHaveLength(500);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "PRIVATE-SCRIPT",
      "PRIVATE-INPUT",
      "PRIVATE-IMAGE",
      "DE89",
      "Duplikat"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("liest alle Klassen-Griffe und speichert nur freigegebene Klassendaten mit stabiler Antwort-ID", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const page = `
      <html><body>
        <div id="klassengrafik_90000000001"
             onclick="formular_fuellen('90000000001')"></div>
        <div onclick=" formular_fuellen('90000000002') ; "></div>
        <div onclick="formular_fuellen('90000000001')"></div>
        <div onclick="formular_fuellen(90000000003)"></div>
        <span onclick="formular_fuellen('90000000004')"></span>
      </body></html>
    `;
    const responses = [
      new Response("<html><body>Session</body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie":
            "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
        },
        status: 200
      }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      }),
      new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200
      }),
      klassenDetailResponse("70000000001"),
      klassenDetailResponse("70000000002")
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ ...(init ? { init } : {}), url: String(input) });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    const result = await client.extractKlassen({
      email: "service-account@example.invalid",
      password: "synthetic-password"
    });

    expect(result).toMatchObject({ area: "klassen", rowCount: 2 });
    expect(result.records.map(({ sourceId }) => sourceId)).toEqual([
      "70000000001",
      "70000000002"
    ]);
    expect(result.records[0]?.payload).toMatchObject({
      id: "70000000001",
      kurzname: "Synthetic",
      wochentag: "1"
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "PRIVATE-LIVE-LINK",
      "PRIVATE-SMS-LIST",
      "PRIVATE-STUDENT",
      "PRIVATE-SMS-TEXT"
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    const detailRequests = requests.slice(-2);
    expect(detailRequests.map(({ url }) => url)).toEqual([
      "https://core.matool.de/json/klassen_daten.php?todo=daten",
      "https://core.matool.de/json/klassen_daten.php?todo=daten"
    ]);
    expect(
      detailRequests.map(({ init }) => String(init?.body))
    ).toEqual(["id=90000000001", "id=90000000002"]);
    expect(
      detailRequests.every(
        ({ init }) =>
          new Headers(init?.headers).get("X-Requested-With") ===
          "XMLHttpRequest"
      )
    ).toBe(true);
  });

  it("bricht den Klassenabruf bei einer inkonsistenten Detailantwort ohne Teilresultat ab", async () => {
    const responses = [
      new Response("<html><body>Session</body></html>", {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie":
            "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
        },
        status: 200
      }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      }),
      new Response(
        `<div onclick="formular_fuellen('90000000001')"></div>
         <div onclick="formular_fuellen('90000000002')"></div>`,
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: 200
        }
      ),
      klassenDetailResponse("70000000001"),
      klassenDetailResponse("70000000001")
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    await expect(
      client.extractKlassen({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).rejects.toMatchObject({
      code: "matool_klassen_schema_mismatch",
      status: 502
    });
  });

  it("blockiert nicht freigegebene Listenbereiche vor dem Login", async () => {
    let requestCount = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        requestCount += 1;
        throw new Error("network must not be reached");
      }) as typeof fetch
    );

    await expect(
      client.extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "kasse"
      )
    ).rejects.toMatchObject({
      code: "matool_area_not_allowed",
      status: 400
    });
    expect(requestCount).toBe(0);
  });
});
