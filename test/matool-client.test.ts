import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import {
  assertAllowedMatoolUrl,
  MATOOL_INTERESSENT_DETAIL_FIELDS,
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

type PaginatedListArea = "interessenten" | "schueler";

function paginationHref(area: PaginatedListArea, offset: number): string {
  return area === "schueler"
    ? `/index.php?show=schueler&amp;todo=&amp;offset=${offset}`
    : `/index.php?show=interessenten&amp;offset=${offset}`;
}

function paginatedListPage(input: {
  area: PaginatedListArea;
  currentOffset: number;
  offsets: readonly number[];
  rows: string;
  selectedOffset?: number;
}): string {
  const selectedOffset = input.selectedOffset ?? input.currentOffset;
  const pagination = input.offsets
    .map((offset, index) =>
      offset === selectedOffset
        ? `<span class="pagination_selected">${index + 1}</span>`
        : `<a class="pagination" href="${paginationHref(input.area, offset)}">${index + 1}</a>`
    )
    .join("");
  const headers =
    input.area === "schueler"
      ? ["NR.", "VORNAME", "NAME", "VERTRAG"]
      : ["Nr.", "Datum", "Vorname", "Name", "Status"];
  const rows =
    input.area === "interessenten"
      ? input.rows
      : `<table>${input.rows}</table>`;
  return `
    <html><body>
      <table>
        <tr class="master_tab_tr_head">
          ${headers.map((header) => `<td>${header}</td>`).join("")}
        </tr>
      </table>
      ${rows}
      <nav>${pagination}</nav>
      <input name="offset" value="0">
    </body></html>
  `;
}

function schuelerRow(sourceId: string, number: number): string {
  return `
    <tr onclick="formular_fuellen(${sourceId},'Synthetic ${sourceId}')">
      <td>${number}</td><td>Vorname ${number}</td><td>Name ${number}</td>
    </tr>
  `;
}

type PaginatedInteressentInput = {
  createdDate: string;
  displayNumber: string;
  firstName: string;
  lastName: string;
  sourceId: string;
  status: string;
};

function paginatedInteressentDataRow(
  input: PaginatedInteressentInput
): string {
  return `
    <tr>
      <td>${input.displayNumber}</td>
      <td>${input.createdDate}</td>
      <td>${input.firstName}</td>
      <td>${input.lastName}</td>
      <td>${input.status}</td>
    </tr>
  `;
}

function paginatedInteressentIdentifierRow(sourceId: string): string {
  return `
    <tr>
      <td><img alt="" onclick="formular_fuellen(${sourceId})"></td>
      <td>
        <table>
          <tr><td>PRIVATE-HIDDEN-DETAIL-A-${sourceId}</td></tr>
          <tr><td>PRIVATE-HIDDEN-DETAIL-B-${sourceId}</td></tr>
        </table>
      </td>
    </tr>
  `;
}

function paginatedInteressentRows(
  input: PaginatedInteressentInput
): string {
  return `<table>${paginatedInteressentDataRow(input)}</table><table>${paginatedInteressentIdentifierRow(input.sourceId)}</table>`;
}

function nestedStrictListRow(
  area: PaginatedListArea,
  sourceId: string,
  label: string
): string {
  const onclick =
    area === "schueler"
      ? `formular_fuellen(${sourceId},'Synthetic ${sourceId}')`
      : `formular_fuellen(${sourceId})`;
  return `
    <tr>
      <td><img onclick="${onclick}" alt=""></td>
      ${area === "schueler" ? "<td></td>" : ""}
      <td>
        <table>
          <tr><td>${label} A</td></tr>
          <tr><td>${label} B</td></tr>
        </table>
      </td>
    </tr>
  `;
}

function clientForPaginatedPages(
  pages: ReadonlyMap<string, { body?: string; status?: number }>,
  requests: string[] = []
): MatoolClient {
  return new MatoolClient(
    "https://core.matool.de",
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;
      requests.push(path);
      if (path === "/index.php" && init?.method === "POST") {
        return new Response(null, {
          headers: { Location: "/index.php" },
          status: 302
        });
      }
      if (path === "/index.php") {
        return new Response("<html><body>Angemeldet</body></html>", {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...(requests.length === 1
              ? {
                  "Set-Cookie":
                    "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
                }
              : {})
          },
          status: 200
        });
      }
      const page = pages.get(path);
      if (!page) {
        throw new Error(`unexpected synthetic request: ${path}`);
      }
      return new Response(page.body ?? "", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: page.status ?? 200
      });
    }) as typeof fetch
  );
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

  it("haelt einen Mindestabstand zwischen MATOOL-Anfragen ein", async () => {
    const zeitpunkte: number[] = [];
    const responses = [
      new Response("<html><body>Session</body></html>", {
        headers: { "Content-Type": "text/html" },
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
        paginatedListPage({
          area: "interessenten",
          currentOffset: 0,
          offsets: [0],
          rows: paginatedInteressentRows({
            createdDate: "01.08.2026",
            displayNumber: "100",
            firstName: "Synthetic",
            lastName: "Lead",
            sourceId: "900001",
            status: "Neu"
          })
        }),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: 200
        }
      )
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        zeitpunkte.push(Date.now());
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch,
      { minRequestIntervalMs: 60 }
    );

    await client.extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(zeitpunkte.length).toBeGreaterThan(1);
    for (let index = 1; index < zeitpunkte.length; index += 1) {
      expect(
        (zeitpunkte[index] ?? 0) - (zeitpunkte[index - 1] ?? 0)
      ).toBeGreaterThanOrEqual(50);
    }
  });

  it("wiederholt eine abgebrochene Anfrage einmal", async () => {
    let versuche = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        versuche += 1;
        throw new TypeError("Network connection lost.");
      }) as typeof fetch,
      { minRequestIntervalMs: 0 }
    );

    await expect(
      client.probeInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).rejects.toThrow(AppError);
    expect(versuche).toBe(2);
    expect(client.requestCount).toBe(2);
  });

  it("wiederholt Interessentenlisten bei 429 und 5xx hoechstens dreimal", async () => {
    const cancelledStatuses: number[] = [];
    const retryResponse = (status: number): Response =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelledStatuses.push(status);
          },
          start(controller) {
            controller.enqueue(new TextEncoder().encode("retry"));
          }
        }),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Retry-After": "0"
          },
          status
        }
      );
    const successfulPage = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0],
      rows: paginatedInteressentRows({
        createdDate: "01.08.2026",
        displayNumber: "100",
        firstName: "Vorname",
        lastName: "Name",
        sourceId: "900001",
        status: "Neu"
      })
    });
    const responses = [
      new Response("<html><body>Session</body></html>", { status: 200 }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", { status: 200 }),
      retryResponse(429),
      retryResponse(503),
      new Response(successfulPage, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200
      })
    ];
    let listRequests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL) => {
        if (String(input).includes("show=interessenten")) {
          listRequests += 1;
        }
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    await expect(
      client.extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    expect(listRequests).toBe(3);
    expect(cancelledStatuses).toEqual([429, 503]);
  });

  it("stoppt Interessentendetail-Retries nach dem dritten HTTP-Fehler", async () => {
    const cancelledStatuses: number[] = [];
    const retryResponse = (status: number): Response =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelledStatuses.push(status);
          },
          start(controller) {
            controller.enqueue(new TextEncoder().encode("retry"));
          }
        }),
        { headers: { "Retry-After": "0" }, status }
      );
    const responses = [
      new Response("<html><body>Session</body></html>", { status: 200 }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", { status: 200 }),
      retryResponse(500),
      retryResponse(429),
      retryResponse(503)
    ];
    let detailRequests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL) => {
        if (String(input).includes("/json/statistik_daten.php")) {
          detailRequests += 1;
        }
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    await expect(
      client.extractInteressentDetail(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "700001"
      )
    ).rejects.toMatchObject({
      code: "matool_interessent_detail_failed",
      status: 502
    });
    expect(detailRequests).toBe(3);
    expect(cancelledStatuses).toEqual([500, 429, 503]);
  });

  it("verwendet fuer den Retry ein frisches Timeout-Signal", async () => {
    const signals: AbortSignal[] = [];
    let requestCount = 0;
    const responses = [
      new Response("<html><body>Session</body></html>", { status: 200 }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", { status: 200 }),
      new Response("<html><body>Interessenten</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      })
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestCount += 1;
        if (init?.signal) {
          signals.push(init.signal);
        }
        if (requestCount === 1) {
          throw new DOMException("Synthetic timeout", "TimeoutError");
        }
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    await expect(
      client.probeInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).resolves.toMatchObject({ status: 200 });

    expect(signals).toHaveLength(5);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("klassifiziert das Runtime-Subrequest-Limit ohne Retry", async () => {
    let requests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        requests += 1;
        throw new Error("Too many subrequests.");
      }) as typeof fetch
    );

    await expect(
      client.probeInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).rejects.toMatchObject({
      code: "matool_subrequest_limit",
      status: 503
    });
    expect(requests).toBe(1);
    expect(client.requestCount).toBe(1);
  });

  it("stoppt vor dem konfigurierten Subrequest-Budget", async () => {
    let requests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        requests += 1;
        return new Response("<html><body>Session</body></html>", {
          status: 200
        });
      }) as typeof fetch,
      { maxRequestCount: 1 }
    );

    await expect(
      client.probeInteressenten({
        email: "service-account@example.invalid",
        password: "synthetic-password"
      })
    ).rejects.toMatchObject({
      code: "matool_subrequest_limit",
      status: 503
    });
    expect(requests).toBe(1);
    expect(client.requestCount).toBe(1);
  });

  it("liest Interessenten-Details lesend und schreibt nichts zurueck", async () => {
    const detailResponse = JSON.stringify([
      {
        id: "606578",
        datum: "09.08.2026",
        anrede: "Weiblich",
        vorname: "Synthetic",
        name: "Lead",
        strasse: "",
        plz: "",
        ort: "",
        telefon: "",
        handy: "01500000000",
        email: "lead@example.invalid",
        quelle: "---",
        kontakt: "Webformular",
        kontaktart: "E-Mail",
        schule: "Teststandort",
        leistung: "Testklasse",
        einfuehrung: "12.08.2026",
        einfuehrung_zeit: "15:00",
        einfuehrung_klasse: "101",
        einfuehrung_klasse_name: "Testklasse A",
        einfuehrung_benutzer: "0",
        einfuehrung_anwesend: "0",
        ergebnis_einfuehrung: "leer",
        probetraining: "19.08.2026",
        probetraining_zeit: "16:00",
        probetraining_klasse: "102",
        probetraining_klasse_name: "Testklasse B",
        probetraining_benutzer: "0",
        probetraining_anwesend: "1",
        ergebnis_probetraining: "erschienen",
        status: "Termin",
        text: "Zeile 1\nZeile 2",
        werbung: "0",
        werbung_bezeichnung: "Ohne"
      }
    ]);
    const calls: Array<{ body: string; method: string; url: string }> = [];
    const fetchImplementation = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = String(input);
      const body =
        init?.body instanceof URLSearchParams ? init.body.toString() : "";
      calls.push({ body, method: init?.method ?? "GET", url });
      if (url.includes("/json/statistik_daten.php")) {
        return new Response(detailResponse, {
          // Entspricht dem HAR: JSON-Inhalt trotz text/html-Mime-Type.
          headers: { "Content-Type": "text/html" },
          status: 200
        });
      }
      if (url.endsWith("/index.php") && init?.method === "POST") {
        return new Response(null, {
          headers: { Location: "/index.php" },
          status: 302
        });
      }
      return new Response("<html><body>Angemeldet</body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200
      });
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
      5,
      ["606578"]
    );

    expect(result.records).toHaveLength(1);
    expect(result.area).toBe("interessenten_details");
    expect(result.records[0]?.sourceId).toBe("606578");
    expect(result.records[0]?.payload).toMatchObject({
      email: "lead@example.invalid",
      einfuehrung: "12.08.2026",
      einfuehrung_klasse_name: "Testklasse A",
      einfuehrung_zeit: "15:00",
      probetraining: "19.08.2026",
      probetraining_klasse_name: "Testklasse B",
      probetraining_zeit: "16:00",
      status: "Termin",
      text: "Zeile 1\nZeile 2",
      werbung: "0",
      werbung_bezeichnung: "Ohne"
    });

    expect(Object.keys(result.records[0]?.payload ?? {}).sort()).toEqual(
      [...MATOOL_INTERESSENT_DETAIL_FIELDS].sort()
    );

    // Nach dem Login genau ein read-only-Detail-POST, kein open/close und
    // kein Listen-GET, wenn der Scheduler die stabile ID bereits liefert.
    expect(
      calls.map(({ body, method, url }) => ({
        body,
        method,
        path: `${new URL(url).pathname}${new URL(url).search}`
      }))
    ).toEqual([
      { body: "", method: "GET", path: "/index.php" },
      {
        body: "mail=service-account%40example.invalid&pass=synthetic-password",
        method: "POST",
        path: "/index.php"
      },
      { body: "", method: "GET", path: "/index.php" },
      {
        body: "id=606578",
        method: "POST",
        path: "/json/statistik_daten.php"
      }
    ]);
    expect(calls.every(({ body }) => !body.includes("todo="))).toBe(true);
  });

  it("liest im Paid-Lauf mehr als das fruehere Paket von 25 Details", async () => {
    const sourceIds = Array.from({ length: 26 }, (_, index) =>
      String(610_000 + index)
    );
    let detailRequests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/json/statistik_daten.php")) {
          detailRequests += 1;
          const id =
            init?.body instanceof URLSearchParams
              ? init.body.get("id") ?? ""
              : "";
          const detail = Object.fromEntries(
            MATOOL_INTERESSENT_DETAIL_FIELDS.map((field) => [field, ""])
          );
          detail.id = id;
          return new Response(JSON.stringify([detail]), {
            headers: { "Content-Type": "text/html" },
            status: 200
          });
        }
        if (url.endsWith("/index.php") && init?.method === "POST") {
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
          status: 200
        });
      }) as typeof fetch
    );

    const result = await client.extractInteressentenDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      sourceIds.length,
      sourceIds
    );

    expect(result.records.map(({ sourceId }) => sourceId)).toEqual(sourceIds);
    expect(detailRequests).toBe(26);
  });

  it("akzeptiert genau einen Detailkandidaten als Array, Objekt oder Objekt-Map", async () => {
    const complete = Object.fromEntries(
      MATOOL_INTERESSENT_DETAIL_FIELDS.map((field) => [field, ""])
    );
    complete.id = "700001";

    for (const responseShape of [complete, [complete], { lead: complete }]) {
      const responses = [
        new Response("<html><body>Session</body></html>", {
          headers: { "Content-Type": "text/html" },
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
        new Response(JSON.stringify(responseShape), {
          headers: { "Content-Type": "text/html" },
          status: 200
        })
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
        client.extractInteressentDetail(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "700001"
        )
      ).resolves.toMatchObject({ sourceId: "700001" });
    }
  });

  it("verwirft unvollstaendige, unbekannte oder ID-fremde Detailantworten vollstaendig", async () => {
    const complete = Object.fromEntries(
      MATOOL_INTERESSENT_DETAIL_FIELDS.map((field) => [field, ""])
    );
    complete.id = "700001";
    const incomplete = { ...complete };
    delete incomplete.email;
    const mismatched = { ...complete, id: "700002" };
    const oversized = { ...complete, text: "x".repeat(2_001) };
    const unknown = { ...complete, unknown_private_field: "unexpected" };

    for (const responsePayload of [
      incomplete,
      mismatched,
      oversized,
      unknown
    ]) {
      const responses = [
        new Response("<html><body>Session</body></html>", { status: 200 }),
        new Response(null, {
          headers: { Location: "/index.php" },
          status: 302
        }),
        new Response("<html><body>Angemeldet</body></html>", { status: 200 }),
        new Response(JSON.stringify([responsePayload]), { status: 200 })
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
        client.extractInteressentDetail(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "700001"
        )
      ).rejects.toMatchObject({
        code: "matool_interessent_detail_schema_mismatch",
        status: 502
      });
    }
  });

  it("verknuepft die sichtbare Interessentenzeile mit der folgenden stabilen ID-Zeile", async () => {
    const page = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0],
      rows: paginatedInteressentRows({
        createdDate: "11.07.2026",
        displayNumber: "5304",
        firstName: "Laura",
        lastName: "Beispiel",
        sourceId: "900001",
        status: "Termin"
      })
    });
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
    expect(JSON.stringify(result)).not.toContain("PRIVATE-HIDDEN-DETAIL");
  });

  it("verwirft fehlende, mehrdeutige und verwaiste Interessenten-ID-Zeilen", async () => {
    const first = {
      createdDate: "01.08.2026",
      displayNumber: "100",
      firstName: "Vorname",
      lastName: "Name",
      sourceId: "900001",
      status: "Neu"
    };
    const second = {
      ...first,
      displayNumber: "101",
      sourceId: "900002"
    };
    const ambiguousIdentifierRow = paginatedInteressentIdentifierRow(
      first.sourceId
    ).replace(
      `<img alt="" onclick="formular_fuellen(${first.sourceId})">`,
      `<img alt="" onclick="formular_fuellen(${first.sourceId})"><button onclick="formular_fuellen(900099)">Mehrdeutig</button>`
    );
    const invalidRows = [
      `${paginatedInteressentRows(first)}<table>${paginatedInteressentDataRow(second)}</table><table><tr><td>Control ohne ID</td><td></td></tr></table>`,
      `<table>${paginatedInteressentDataRow(first)}</table><table>${ambiguousIdentifierRow}</table>`,
      `${paginatedInteressentRows(first)}<table>${paginatedInteressentIdentifierRow(second.sourceId)}</table>`
    ];

    for (const rows of invalidRows) {
      const body = paginatedListPage({
        area: "interessenten",
        currentOffset: 0,
        offsets: [0],
        rows
      });
      const pages = new Map([
        ["/index.php?show=interessenten&offset=0", { body }]
      ]);
      await expect(
        clientForPaginatedPages(pages).extractSafeArea(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "interessenten"
        )
      ).rejects.toMatchObject({
        code: "matool_paginated_list_schema_mismatch",
        status: 502
      });
    }
  });

  it("benennt Spalten nach der Kopfzeile, auch wenn sie in einer eigenen Tabelle steht", async () => {
    const page = `
      <html><body><h1>Artikel</h1>
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
      "artikel"
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
      <html><body><h1>Artikel</h1>
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
      "artikel"
    );

    expect(result.records[0]?.payload).toMatchObject({
      c00: "4711",
      c01: "01.01.2026"
    });
  });

  it("speichert in Interessentenlisten nur Zeilen mit stabilen IDs", async () => {
    const longCell = "x".repeat(700);
    const page = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0],
      rows:
        paginatedInteressentRows({
          createdDate: "01.08.2026",
          displayNumber: "100",
          firstName:
            "Alice<script>PRIVATE-SCRIPT</script><input value=\"PRIVATE-INPUT\"><img alt=\"PRIVATE-IMAGE\">",
          lastName: "Beispiel",
          sourceId: "900001",
          status: "DE89 3704 0044 0532 0130 00"
        }) +
        `<table><tr><td><a href="/index.php?show=interessenten&amp;page=2">Weiter</a></td></tr>
         <tr><td>${longCell}</td><td>Nur Layout</td></tr></table>`
    });
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
      rowCount: 1
    });
    expect(result.records[0]).toEqual({
      sourceId: "900001",
      payload: {
        nr: "100",
        datum: "01.08.2026",
        vorname: "Alice",
        name: "Beispiel",
        status: "",
        columnCount: 5,
        tableIndex: 1
      }
    });
    expect(result.records.every(({ sourceId }) => /^\d+$/u.test(sourceId))).toBe(
      true
    );
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "PRIVATE-SCRIPT",
      "PRIVATE-INPUT",
      "PRIVATE-IMAGE",
      "DE89",
      "PRIVATE-HIDDEN-DETAIL"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("verwirft eine strikte Liste ohne ausgewaehlte erste Seite", async () => {
    const body = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0],
      rows: paginatedInteressentRows({
        createdDate: "01.08.2026",
        displayNumber: "100",
        firstName: "Vorname",
        lastName: "Name",
        sourceId: "900001",
        status: "Neu"
      })
    }).replace('class="pagination_selected"', 'class="not_selected"');
    const pages = new Map([
      ["/index.php?show=interessenten&offset=0", { body }]
    ]);

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch"
    });
  });

  it("liest alle angezeigten Interessentenseiten ab offset null genau einmal", async () => {
    const offsets = [0, 30, 60];
    const requests: string[] = [];
    const pages = new Map<string, { body: string }>();
    let expectedBodyBytes = 0;
    const expectedSourceIds: string[] = [];
    let recordIndex = 0;
    for (const [index, offset] of offsets.entries()) {
      const pageSize = offset === offsets.at(-1) ? 11 : 30;
      const rows = Array.from({ length: pageSize }, () => {
        const current = recordIndex;
        recordIndex += 1;
        const sourceId = String(900_001 + current);
        expectedSourceIds.push(sourceId);
        return paginatedInteressentRows({
          createdDate: `0${index + 1}.08.2026`,
          displayNumber: String(100 + current),
          firstName: `Vorname ${current}`,
          lastName: `Name ${current}`,
          sourceId,
          status: "Neu"
        });
      }).join("");
      const body = paginatedListPage({
        area: "interessenten",
        currentOffset: offset,
        offsets,
        rows:
          rows +
          (offset === 0
            ? "<table><tr><td>Layout ohne ID</td></tr></table>"
            : "")
      });
      expectedBodyBytes += new TextEncoder().encode(body).byteLength;
      pages.set(`/index.php?show=interessenten&offset=${offset}`, { body });
    }

    const result = await clientForPaginatedPages(
      pages,
      requests
    ).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "interessenten"
    );

    expect(result.records.map(({ sourceId }) => sourceId)).toEqual(
      expectedSourceIds
    );
    expect(result.rowCount).toBe(71);
    expect(result.bodyBytes).toBe(expectedBodyBytes);
    expect(requests.slice(-3)).toEqual([
      "/index.php?show=interessenten&offset=0",
      "/index.php?show=interessenten&offset=30",
      "/index.php?show=interessenten&offset=60"
    ]);
  });

  it("laesst die bestehende verschachtelte Schuelerzuordnung unveraendert", async () => {
      const area = "schueler" as const;
      const ids = ["710001", "710002"];
      const offsets = [0, 30];
      const pages = new Map<string, { body: string }>();
      for (const [index, offset] of offsets.entries()) {
        const sourceId = ids[index] ?? "";
        const path = paginationHref(area, offset).replaceAll("&amp;", "&");
        pages.set(path, {
          body: paginatedListPage({
            area,
            currentOffset: offset,
            offsets,
            rows: nestedStrictListRow(
              area,
              sourceId,
              `Synthetic-${index + 1}`
            )
          })
        });
      }

      const result = await clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        area
      );

      expect(result.records.map(({ sourceId }) => sourceId)).toEqual(ids);
      expect(result.records).toHaveLength(2);
      expect(result.records[0]?.payload.c02).toBe(
        "Synthetic-1 A Synthetic-1 B"
      );
      expect(result.records[1]?.payload.c02).toBe(
        "Synthetic-2 A Synthetic-2 B"
      );
  });

  it("liest eine Schuelerliste mit mehr als 500 stabilen Datensaetzen vollstaendig", async () => {
    const offsets = Array.from({ length: 17 }, (_, index) => index * 30);
    const pages = new Map<string, { body: string }>();
    let recordIndex = 0;
    for (const offset of offsets) {
      const pageSize = offset === offsets.at(-1) ? 21 : 30;
      const rows = Array.from({ length: pageSize }, () => {
        const current = recordIndex;
        recordIndex += 1;
        return schuelerRow(String(700_000 + current), current + 1);
      }).join("");
      pages.set(`/index.php?show=schueler&todo=&offset=${offset}`, {
        body: paginatedListPage({
          area: "schueler",
          currentOffset: offset,
          offsets,
          rows
        })
      });
    }

    const result = await clientForPaginatedPages(pages).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "schueler"
    );

    expect(result.rowCount).toBe(501);
    expect(result.records[0]?.sourceId).toBe("700000");
    expect(result.records.at(-1)?.sourceId).toBe("700500");
  });

  it("verwirft eine vollstaendig gelesene paginierte Liste ohne Datensaetze", async () => {
    const offsets = [0, 30];
    const pages = new Map<string, { body: string }>();
    for (const offset of offsets) {
      pages.set(`/index.php?show=interessenten&offset=${offset}`, {
        body: paginatedListPage({
          area: "interessenten",
          currentOffset: offset,
          offsets,
          rows: "<table><tr><td>Nur Layout ohne stabile ID</td></tr></table>"
        })
      });
    }

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch"
    });
  });

  it.each([
    "https://attacker.invalid/index.php?show=interessenten&offset=30",
    "/index.php?show=interessenten&offset=30&unexpected=1"
  ])("verwirft einen unzulaessigen Pagination-Link %s", async (invalidHref) => {
    const body = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0, 30],
      rows: paginatedInteressentRows({
        createdDate: "01.08.2026",
        displayNumber: "100",
        firstName: "Vorname",
        lastName: "Name",
        sourceId: "900001",
        status: "Neu"
      })
    }).replace(paginationHref("interessenten", 30), invalidHref);
    const pages = new Map([
      ["/index.php?show=interessenten&offset=0", { body }]
    ]);

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch",
      status: 502
    });
  });

  it("bricht bei einer fehlgeschlagenen Folgeseite ohne Teilresultat ab", async () => {
    const offsets = [0, 30];
    const pages = new Map<string, { body?: string; status?: number }>([
      [
        "/index.php?show=interessenten&offset=0",
        {
          body: paginatedListPage({
            area: "interessenten",
            currentOffset: 0,
            offsets,
            rows: paginatedInteressentRows({
              createdDate: "01.08.2026",
              displayNumber: "100",
              firstName: "Vorname",
              lastName: "Name",
              sourceId: "900001",
              status: "Neu"
            })
          })
        }
      ],
      ["/index.php?show=interessenten&offset=30", { status: 503 }]
    ]);

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({ code: "matool_unexpected_status" });
  });

  it("verwirft identische Duplikate ueber Seitengrenzen", async () => {
    const offsets = [0, 30];
    const duplicate = (status: string): string =>
      paginatedInteressentRows({
        createdDate: "01.08.2026",
        displayNumber: "100",
        firstName: "Vorname",
        lastName: "Name",
        sourceId: "900001",
        status
      });
    const pages = new Map([
      [
        "/index.php?show=interessenten&offset=0",
        {
          body: paginatedListPage({
            area: "interessenten",
            currentOffset: 0,
            offsets,
            rows: duplicate("Neu")
          })
        }
      ],
      [
        "/index.php?show=interessenten&offset=30",
        {
          body: paginatedListPage({
            area: "interessenten",
            currentOffset: 30,
            offsets,
            rows: duplicate("Neu")
          })
        }
      ]
    ]);

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch"
    });
  });

  it("verwirft identische Duplikate innerhalb einer Seite", async () => {
    const row = paginatedInteressentRows({
      createdDate: "01.08.2026",
      displayNumber: "100",
      firstName: "Vorname",
      lastName: "Name",
      sourceId: "900001",
      status: "Neu"
    });
    const body = paginatedListPage({
      area: "interessenten",
      currentOffset: 0,
      offsets: [0],
      rows: `${row}${row}`
    });
    const pages = new Map([
      ["/index.php?show=interessenten&offset=0", { body }]
    ]);

    await expect(
      clientForPaginatedPages(pages).extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "interessenten"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch"
    });
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

  it("waehlt ein Klassenpaket mit Offset deterministisch und zyklisch", async () => {
    const detailBodies: string[] = [];
    const page = `<html><body>${Array.from(
      { length: 5 },
      (_, index) =>
        `<div onclick="formular_fuellen('9000000000${index + 1}')"></div>`
    ).join("")}</body></html>`;
    const responses = [
      new Response("<html><body>Session</body></html>", { status: 200 }),
      new Response(null, {
        headers: { Location: "/index.php" },
        status: 302
      }),
      new Response("<html><body>Angemeldet</body></html>", { status: 200 }),
      new Response(page, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 200
      }),
      klassenDetailResponse("70000000005"),
      klassenDetailResponse("70000000001")
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof URLSearchParams) {
          detailBodies.push(init.body.toString());
        }
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    const result = await client.extractKlassen(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      { maxRecords: 2, offset: 4 }
    );

    expect(result.records.map(({ sourceId }) => sourceId)).toEqual([
      "70000000005",
      "70000000001"
    ]);
    expect(detailBodies.slice(-2)).toEqual([
      "id=90000000005",
      "id=90000000001"
    ]);
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
