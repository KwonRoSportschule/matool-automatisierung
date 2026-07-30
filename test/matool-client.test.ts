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
});
