import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import { sha256Hex } from "../src/core/crypto";
import { MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS } from "../src/matool/artikel-detail";
import {
  assertAllowedMatoolUrl,
  MATOOL_INTERESSENT_DETAIL_FIELDS,
  MatoolClient,
  MatoolShapeMismatchError,
  validateMatoolBaseUrl
} from "../src/matool/client";
import { MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS } from "../src/matool/schueler-detail";

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
        schuelerliste: [
          {
            alter: "12",
            austritt: null,
            bildlink: "PRIVATE-STUDENT-IMAGE",
            nachname: "PRIVATE-STUDENT-LAST",
            schueler_nr_schulintern: "PRIVATE-STUDENT-ID",
            vorname: "PRIVATE-STUDENT-FIRST"
          }
        ],
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

function schuelerDetailBody(
  sourceId: string,
  overrides: Record<string, unknown> = {}
): string {
  const record = Object.fromEntries(
    MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS.map((field, index) => [
      field,
      `synthetic-${index}`
    ])
  );
  record.schueler_nr = sourceId;
  Object.assign(record, overrides);
  return JSON.stringify([record]);
}

function artikelDetailBody(
  sourceId: string,
  overrides: Record<string, unknown> = {}
): string {
  const record = Object.fromEntries(
    MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS.map((field, index) => [
      field,
      `synthetic-${index}`
    ])
  );
  record.id = sourceId;
  Object.assign(record, overrides);
  return JSON.stringify([record]);
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

/**
 * Bildet den am 25.08.2026 aus der Live-Antwort aufgenommenen Aufbau nach:
 * eine sichtbare Zeile mit den vier Spalten der Kopfzeile, gefolgt von der
 * Kennungszeile mit drei Zellen, der Aufklapp-Aktion und zwei
 * verschachtelten Detailzeilen.
 */
function schuelerRow(sourceId: string, number: number): string {
  return `
    ${schuelerDataRow(number)}
    ${schuelerIdentifierRow(sourceId)}
  `;
}

function schuelerDataRow(number: number): string {
  return `
    <tr>
      <td>${number}&euro;</td>
      <td>Vorname ${number}</td>
      <td>Gr&ouml;&szlig;mann ${number}</td>
      <td>Vertrag&nbsp;Synthetic ${number}</td>
    </tr>
  `;
}

function schuelerIdentifierRow(
  sourceId: string,
  onclick = `formular_fuellen(${sourceId},'Synthetic ${sourceId}')`
): string {
  return `
    <tr>
      <td><img alt="" onclick="${onclick}"></td>
      <td>
        <table>
          <tr><td>PRIVATE-HIDDEN-DETAIL-A-${sourceId}</td></tr>
          <tr><td>PRIVATE-HIDDEN-DETAIL-B-${sourceId}</td></tr>
        </table>
      </td>
      <td></td>
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
          <tr><td>${label} A ${label} B</td></tr>
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

type ExactPaginatedListArea = "artikel" | "lager";

function exactPaginationHref(
  area: ExactPaginatedListArea,
  offset: number
): string {
  return `/index.php?show=${area}&amp;offset=${offset}`;
}

function exactPaginatedListPage(input: {
  area: ExactPaginatedListArea;
  currentOffset: number;
  headers: readonly string[];
  offsets: readonly number[];
  records: string;
}): string {
  const pagination = input.offsets
    .map((offset, index) =>
      offset === input.currentOffset
        ? `<span class="pagination_selected">${index + 1}</span>`
        : `<a class="pagination" href="${exactPaginationHref(input.area, offset)}">${index + 1}</a>`
    )
    .join("");
  return `
    <html><body>
      <table><tr class="master_tab_tr_head">
        ${input.headers.map((header) => `<td>${header}</td>`).join("")}
      </tr></table>
      ${input.records}
      <nav>${pagination}</nav>
    </body></html>
  `;
}

function artikelListRecord(
  sourceId: string,
  values: readonly [string, string, string, string, string]
): string {
  return `
    <table><tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr></table>
    <table><tr>
      <td><button onclick="formular_fuellen(${sourceId},'none')">Öffnen</button></td>
      <td><button onclick="formular_fuellen('${sourceId}','clone')">Klonen</button></td>
      <td><table><tr><td>PRIVATE-ARTICLE-DETAIL-${sourceId}</td></tr></table></td>
    </tr></table>
  `;
}

function lagerListRecord(
  sourceId: string,
  values: readonly [string, string, string, string]
): string {
  return `
    <span onclick="detail_toggle(${sourceId})">
      <table><tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr></table>
    </span>
    <div id="lagerbewegung${sourceId}">
      <table><tr><td>PRIVATE-LAGER-DETAIL-${sourceId}</td></tr></table>
    </div>
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

  it("liest mehrere Schuelerdetails einmal angemeldet in angeforderter Reihenfolge", async () => {
    const sourceIds = ["710001", "710002"];
    const detailCalls: RequestInit[] = [];
    let expectedBodyBytes = 0;
    let loginPosts = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/json/schueler_daten.php") {
          if (!init) {
            throw new Error("missing synthetic request init");
          }
          detailCalls.push(init);
          const id =
            init.body instanceof URLSearchParams
              ? init.body.get("id") ?? ""
              : "";
          const body = schuelerDetailBody(id, {
            klassenliste: [{ id: "synthetic-class" }]
          });
          expectedBodyBytes += new TextEncoder().encode(body).byteLength;
          return new Response(body, { status: 200 });
        }
        if (url.pathname === "/index.php" && init?.method === "POST") {
          loginPosts += 1;
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          status: 200
        });
      }) as typeof fetch
    );

    const result = await client.extractSchuelerDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      sourceIds
    );

    expect(result).toMatchObject({
      area: "schueler_details",
      bodyBytes: expectedBodyBytes,
      rowCount: 2
    });
    expect(result.records.map(({ sourceId }) => sourceId)).toEqual(sourceIds);
    expect(loginPosts).toBe(1);
    expect(detailCalls.map(({ body }) => String(body))).toEqual([
      "id=710001&todo=",
      "id=710002&todo="
    ]);
    expect(
      detailCalls.every(({ headers, method }) => {
        const normalized = new Headers(headers);
        return (
          method === "POST" &&
          normalized.get("Accept") ===
            "application/json, text/javascript, */*; q=0.01" &&
          normalized.get("Content-Type") ===
            "application/x-www-form-urlencoded; charset=UTF-8" &&
          normalized.get("X-Requested-With") === "XMLHttpRequest"
        );
      })
    ).toBe(true);
  });

  it("liest mehrere Artikeldetails mit korrektem read-only Body", async () => {
    const sourceIds = ["810001", "810002"];
    const detailCalls: RequestInit[] = [];
    let expectedBodyBytes = 0;
    let loginPosts = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/json/artikel_daten.php") {
          if (!init) {
            throw new Error("missing synthetic request init");
          }
          detailCalls.push(init);
          const id =
            init.body instanceof URLSearchParams
              ? init.body.get("id") ?? ""
              : "";
          const body = artikelDetailBody(id);
          expectedBodyBytes += new TextEncoder().encode(body).byteLength;
          return new Response(body, { status: 200 });
        }
        if (url.pathname === "/index.php" && init?.method === "POST") {
          loginPosts += 1;
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          status: 200
        });
      }) as typeof fetch
    );

    const result = await client.extractArtikelDetails(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      sourceIds
    );

    expect(result).toMatchObject({
      area: "artikel_details",
      bodyBytes: expectedBodyBytes,
      rowCount: 2
    });
    expect(result.records.map(({ sourceId }) => sourceId)).toEqual(sourceIds);
    expect(loginPosts).toBe(1);
    expect(detailCalls.map(({ body }) => String(body))).toEqual([
      "id=810001",
      "id=810002"
    ]);
    expect(
      detailCalls.every(
        ({ headers }) =>
          new Headers(headers).get("X-Requested-With") === "XMLHttpRequest"
      )
    ).toBe(true);
  });

  it("bricht Detailpakete bei fremder ID oder falschem Schema ohne Ergebnis ab", async () => {
    const article = JSON.parse(artikelDetailBody("810001")) as Array<
      Record<string, unknown>
    >;
    delete article[0]?.bezeichnung;
    const scenarios = [
      {
        body: schuelerDetailBody("710099"),
        code: "matool_schueler_detail_schema_mismatch",
        endpoint: "/json/schueler_daten.php",
        kind: "schueler"
      },
      {
        body: JSON.stringify(article),
        code: "matool_artikel_detail_schema_mismatch",
        endpoint: "/json/artikel_daten.php",
        kind: "artikel"
      }
    ] as const;

    for (const scenario of scenarios) {
      const client = new MatoolClient(
        "https://core.matool.de",
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          if (url.pathname === scenario.endpoint) {
            return new Response(scenario.body, { status: 200 });
          }
          if (url.pathname === "/index.php" && init?.method === "POST") {
            return new Response(null, {
              headers: { Location: "/index.php" },
              status: 302
            });
          }
          return new Response("<html><body>Angemeldet</body></html>", {
            status: 200
          });
        }) as typeof fetch
      );
      const request =
        scenario.kind === "schueler"
          ? client.extractSchuelerDetails(
              {
                email: "service-account@example.invalid",
                password: "synthetic-password"
              },
              ["710001"]
            )
          : client.extractArtikelDetails(
              {
                email: "service-account@example.invalid",
                password: "synthetic-password"
              },
              ["810001"]
            );
      await expect(request).rejects.toMatchObject({
        code: scenario.code,
        status: 502
      });
    }
  });

  it("wiederholt einen 429-Schuelerdetailstatus und liefert danach Erfolg", async () => {
    let detailRequests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/json/schueler_daten.php") {
          detailRequests += 1;
          return detailRequests === 1
            ? new Response("retry", {
                headers: { "Retry-After": "0" },
                status: 429
              })
            : new Response(schuelerDetailBody("710001"), { status: 200 });
        }
        if (url.pathname === "/index.php" && init?.method === "POST") {
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          status: 200
        });
      }) as typeof fetch
    );

    await expect(
      client.extractSchuelerDetails(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        ["710001"]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    expect(detailRequests).toBe(2);
  });

  it("stoppt Artikeldetail-Retries nach drei 5xx-Antworten", async () => {
    let detailRequests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/json/artikel_daten.php") {
          detailRequests += 1;
          return new Response("retry", {
            headers: { "Retry-After": "0" },
            status: 503
          });
        }
        if (url.pathname === "/index.php" && init?.method === "POST") {
          return new Response(null, {
            headers: { Location: "/index.php" },
            status: 302
          });
        }
        return new Response("<html><body>Angemeldet</body></html>", {
          status: 200
        });
      }) as typeof fetch
    );

    await expect(
      client.extractArtikelDetails(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        ["810001"]
      )
    ).rejects.toMatchObject({
      code: "matool_artikel_detail_failed",
      status: 502
    });
    expect(detailRequests).toBe(3);
  });

  it("blockiert leere, ungueltige, doppelte oder uebergrosse Detail-ID-Pakete vor Login", async () => {
    let requests = 0;
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        requests += 1;
        throw new Error("unexpected synthetic request");
      }) as typeof fetch
    );
    const credentials = {
      email: "service-account@example.invalid",
      password: "synthetic-password"
    };
    const invocations = [
      () => client.extractSchuelerDetails(credentials, []),
      () => client.extractSchuelerDetails(credentials, ["not-numeric"]),
      () => client.extractArtikelDetails(credentials, ["810001", "810001"]),
      () =>
        client.extractArtikelDetails(
          credentials,
          Array.from({ length: 20_001 }, (_, index) => String(index + 1))
        )
    ];

    for (const invoke of invocations) {
      await expect(invoke()).rejects.toMatchObject({ status: 400 });
    }
    expect(requests).toBe(0);
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

  it("gibt bei abweichendem Schema die beobachtete Form mit, ohne Inhalte", async () => {
    const body = paginatedListPage({
      area: "schueler",
      currentOffset: 0,
      offsets: [0],
      // Kopfzeile passt, aber die sichtbare Zeile fehlt vollstaendig.
      rows: schuelerIdentifierRow("710001")
    });
    const pages = new Map([
      ["/index.php?show=schueler&todo=&offset=0", { body }]
    ]);

    const fehler = await clientForPaginatedPages(pages)
      .extractSafeArea(
        {
          email: "service-account@example.invalid",
          password: "synthetic-password"
        },
        "schueler"
      )
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(fehler).toBeInstanceOf(MatoolShapeMismatchError);
    const { shape } = fehler as MatoolShapeMismatchError;
    expect(shape.area).toBe("schueler");
    expect(shape.headerNamesByColumnCount?.["4"]).toEqual([
      "nr",
      "vorname",
      "name",
      "vertrag"
    ]);
    expect(shape.rowShapes?.length ?? 0).toBeGreaterThan(0);
    // Die Diagnose darf Formangaben fuehren, aber keine Zellwerte.
    expect(JSON.stringify(shape)).not.toContain("PRIVATE-HIDDEN-DETAIL");
  });

  it("benennt generische Spalten nach einer separaten Kopfzeile", async () => {
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
      "checkin"
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

  it("behaelt bei generischen widersprechenden Kopfzeilen die Nummerierung", async () => {
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
      "checkin"
    );

    expect(result.records[0]?.payload).toMatchObject({
      c00: "4711",
      c01: "01.01.2026"
    });
  });

  it("liest alle belegten Artikelseiten mit stabiler ID und vollstaendigen Zellen", async () => {
    const offsets = [0, 25, 50, 75];
    const pages = new Map<string, { body: string }>();
    const requests: string[] = [];
    const longLabel = `Artikel-${"x".repeat(700)}`;
    for (const [index, offset] of offsets.entries()) {
      const sourceId = String(810_001 + index);
      pages.set(`/index.php?show=artikel&offset=${offset}`, {
        body: exactPaginatedListPage({
          area: "artikel",
          currentOffset: offset,
          headers: ["Nr.", "Bezeichnung", "Kategorie", "Preis", "Status"],
          offsets,
          records: artikelListRecord(sourceId, [
            String(index + 1),
            index === 0 ? longLabel : `Artikel ${index + 1}`,
            "Ausrüstung",
            "19,90",
            "Aktiv"
          ])
        })
      });
    }

    const result = await clientForPaginatedPages(
      pages,
      requests
    ).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "artikel"
    );

    expect(result.records.map(({ sourceId }) => sourceId)).toEqual([
      "810001",
      "810002",
      "810003",
      "810004"
    ]);
    expect(result.records[0]?.payload.bezeichnung).toBe(longLabel);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-ARTICLE-DETAIL");
    expect(requests.slice(-4)).toEqual(
      offsets.map((offset) => `/index.php?show=artikel&offset=${offset}`)
    );
  });

  it("verwirft unvollstaendige, widerspruechliche und doppelte Artikel-IDs", async () => {
    const valid = artikelListRecord("810001", [
      "1",
      "Artikel",
      "Kategorie",
      "10,00",
      "Aktiv"
    ]);
    const missingClone = valid.replace(
      `<button onclick="formular_fuellen('810001','clone')">Klonen</button>`,
      ""
    );
    const conflicting = valid.replace(
      "formular_fuellen('810001','clone')",
      "formular_fuellen('810002','clone')"
    );
    const invalidRecordSets = [
      missingClone,
      conflicting,
      `${valid}${valid}`,
      "<table><tr><td>Nur Layout</td></tr></table>"
    ];

    for (const records of invalidRecordSets) {
      const pages = new Map([
        [
          "/index.php?show=artikel&offset=0",
          {
            body: exactPaginatedListPage({
              area: "artikel",
              currentOffset: 0,
              headers: ["Nr.", "Bezeichnung", "Kategorie", "Preis", "Status"],
              offsets: [0],
              records
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
          "artikel"
        )
      ).rejects.toMatchObject({
        code: "matool_exact_list_schema_mismatch",
        status: 502
      });
    }
  });

  it("liest alle 168 belegten Lagerseiten und ignoriert Bewegungsdetails", async () => {
    const offsets = Array.from({ length: 168 }, (_, index) => index * 25);
    const pages = new Map<string, { body: string }>();
    const requests: string[] = [];
    for (const [index, offset] of offsets.entries()) {
      const sourceId = String(820_001 + index);
      pages.set(`/index.php?show=lager&offset=${offset}`, {
        body: exactPaginatedListPage({
          area: "lager",
          currentOffset: offset,
          headers: ["Artikel", "Bestand", "Einheit", "Ort"],
          offsets,
          records: lagerListRecord(sourceId, [
            `Artikel ${index + 1}`,
            String(index + 10),
            "Stück",
            "Hauptlager"
          ])
        })
      });
    }

    const result = await clientForPaginatedPages(
      pages,
      requests
    ).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "lager"
    );

    expect(result.rowCount).toBe(168);
    expect(result.records[0]?.sourceId).toBe("820001");
    expect(result.records.at(-1)?.sourceId).toBe("820168");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-LAGER-DETAIL");
    expect(requests.slice(-168)).toEqual(
      offsets.map((offset) => `/index.php?show=lager&offset=${offset}`)
    );
    // 168 Seiten HTML: unter Last reichen fuenfzehn Sekunden nicht
    // verlaesslich.
  }, 30_000);

  it("verwirft fehlende, widerspruechliche und doppelte Lager-Struktur", async () => {
    const valid = lagerListRecord("820001", [
      "Artikel",
      "10",
      "Stück",
      "Hauptlager"
    ]);
    const invalidRecordSets = [
      valid.replace("lagerbewegung820001", "lagerbewegung820002"),
      valid.slice(0, valid.indexOf('<div id="lagerbewegung820001">')),
      `${valid}${valid}`,
      "<table><tr><td>Nur Layout</td></tr></table>"
    ];
    for (const records of invalidRecordSets) {
      const pages = new Map([
        [
          "/index.php?show=lager&offset=0",
          {
            body: exactPaginatedListPage({
              area: "lager",
              currentOffset: 0,
              headers: ["Artikel", "Bestand", "Einheit", "Ort"],
              offsets: [0],
              records
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
          "lager"
        )
      ).rejects.toMatchObject({
        code: "matool_exact_list_schema_mismatch",
        status: 502
      });
    }
  });

  it("kanonisiert doppelte Newsletter-Links pro stabiler ID genau einmal", async () => {
    const longSubject = `Betreff-${"n".repeat(700)}`;
    const page = `
      <html><body><table>
        <tr class="master_tab_tr_head"><td>Betreff</td><td>Datum</td></tr>
        <tr><td>
          <a href="/misc/show_newsletter.php?id=830001">${longSubject}</a>
          <a href="/misc/show_newsletter.php?id=830001">Öffnen</a>
        </td><td>24.08.2026</td></tr>
        <tr><td><a href="/misc/show_newsletter.php?id=830002">Zweiter</a></td><td>23.08.2026</td></tr>
        <tr><td>Erklärter Layout-Hinweis</td></tr>
      </table></body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "newsletter"
    );

    expect(result.records.map(({ sourceId }) => sourceId)).toEqual([
      "830001",
      "830002"
    ]);
    expect(String(result.records[0]?.payload.betreff)).toContain(longSubject);
  });

  it("verwirft Newsletter-Zeilen ohne eindeutige stabile ID", async () => {
    const invalidRows = [
      "<tr><td>Sichtbarer Betreff</td><td>24.08.2026</td></tr>",
      '<tr><td><a href="/misc/show_newsletter.php?id=830001">A</a><a href="/misc/show_newsletter.php?id=830002">B</a></td><td>24.08.2026</td></tr>',
      '<tr><td><a href="/misc/show_newsletter.php?id=830001">A</a></td><td>24.08.2026</td></tr><tr><td><a href="/misc/show_newsletter.php?id=830001">A</a></td><td>24.08.2026</td></tr>',
      ""
    ];
    for (const rows of invalidRows) {
      const page = `<html><body><table><tr class="master_tab_tr_head"><td>Betreff</td><td>Datum</td></tr>${rows}</table></body></html>`;
      await expect(
        clientForInteressentenPage(page).extractSafeArea(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "newsletter"
        )
      ).rejects.toMatchObject({
        code: "matool_exact_list_schema_mismatch",
        status: 502
      });
    }
  });

  it("hasht den Archivpfad als Store-kompatible ID und behaelt ihn im Payload", async () => {
    const longName = `Datei-${"a".repeat(700)}`;
    const page = `
      <html><body><table>
        <tr class="master_tab_tr_head"><td>Datei</td><td>Typ</td><td>Datum</td><td>Download</td></tr>
        <tr><td>${longName}</td><td>PDF</td><td>24.08.2026</td><td><a href="/archiv/tenant-a/report-1.pdf">Download</a></td></tr>
        <tr><td>Zweite Datei</td><td>CSV</td><td>23.08.2026</td><td><a href="archiv/tenant-a/report-2.csv">Download</a></td></tr>
      </table></body></html>
    `;
    const result = await clientForInteressentenPage(page).extractSafeArea(
      {
        email: "service-account@example.invalid",
        password: "synthetic-password"
      },
      "archiv"
    );

    const paths = [
      "archiv/tenant-a/report-1.pdf",
      "archiv/tenant-a/report-2.csv"
    ];
    expect(result.records.map(({ sourceId }) => sourceId)).toEqual(
      await Promise.all(paths.map((path) => sha256Hex(path)))
    );
    expect(
      result.records.every(({ sourceId }) => /^[a-f0-9]{64}$/u.test(sourceId))
    ).toBe(true);
    expect(result.records.map(({ payload }) => payload.archiv_pfad)).toEqual(
      paths
    );
    expect(result.records[0]?.payload.datei).toBe(longName);
  });

  it("verwirft Archiv-Zeilen ohne eindeutigen Downloadpfad", async () => {
    const valid = '<tr><td>Datei</td><td>PDF</td><td>24.08.2026</td><td><a href="/archiv/tenant-a/report.pdf">Download</a></td></tr>';
    const invalidRows = [
      "<tr><td>Datei</td><td>PDF</td><td>24.08.2026</td><td>Kein Link</td></tr>",
      '<tr><td>Datei</td><td>PDF</td><td>24.08.2026</td><td><a href="/archiv/tenant-a/a.pdf">A</a><a href="/archiv/tenant-a/b.pdf">B</a></td></tr>',
      `${valid}${valid}`,
      ""
    ];
    for (const rows of invalidRows) {
      const page = `<html><body><table><tr class="master_tab_tr_head"><td>Datei</td><td>Typ</td><td>Datum</td><td>Download</td></tr>${rows}</table></body></html>`;
      await expect(
        clientForInteressentenPage(page).extractSafeArea(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "archiv"
        )
      ).rejects.toMatchObject({
        code: "matool_exact_list_schema_mismatch",
        status: 502
      });
    }
  });

  it("verwirft nicht unterstuetzte Pagination bei Newsletter und Archiv", async () => {
    const scenarios = [
      {
        area: "newsletter",
        row: '<tr><td><a href="/misc/show_newsletter.php?id=830001">Synthetisch</a></td><td>24.08.2026</td></tr>',
        headers: "<td>Betreff</td><td>Datum</td>"
      },
      {
        area: "archiv",
        row: '<tr><td>Datei</td><td>PDF</td><td>24.08.2026</td><td><a href="/archiv/tenant-a/report.pdf">Download</a></td></tr>',
        headers: "<td>Datei</td><td>Typ</td><td>Datum</td><td>Download</td>"
      }
    ] as const;

    for (const { area, headers, row } of scenarios) {
      const page = `<html><body><table><tr class="master_tab_tr_head">${headers}</tr>${row}</table><a class="pagination" href="/index.php?show=${area}&offset=30">2</a></body></html>`;
      await expect(
        clientForInteressentenPage(page).extractSafeArea(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          area
        )
      ).rejects.toMatchObject({
        code: "matool_exact_list_schema_mismatch",
        status: 502
      });
    }
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

  it("ordnet die verschachtelte Vertragszelle den vier bestaetigten Schuelerfeldern zu", async () => {
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
            rows: schuelerRow(sourceId, index + 1)
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
      expect(result.records[0]?.payload).toMatchObject({
        name: "Größmann 1",
        nr: "1€",
        vertrag: "Vertrag Synthetic 1",
        vorname: "Vorname 1"
      });
      expect(result.records[1]?.payload).toMatchObject({
        name: "Größmann 2",
        nr: "2€",
        vertrag: "Vertrag Synthetic 2",
        vorname: "Vorname 2"
      });
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
    // 17 Seiten mit je 30 zweigeteilten Zeilen: unter Last reicht die
    // Vorgabe von fuenf Sekunden nicht verlaesslich.
  }, 30_000);

  it("verwirft jede Abweichung von der live bestaetigten Schuelerzeile", async () => {
    const invalidRows = [
      // sichtbare Zeile ohne folgende Kennungszeile
      schuelerDataRow(1),
      // Kennungszeile ohne zugehoerige sichtbare Zeile
      schuelerIdentifierRow("710001"),
      // Aufklapp-Aktion ohne zweites Argument, also ohne belegbare Kennung
      `${schuelerDataRow(1)}${schuelerIdentifierRow(
        "710001",
        "formular_fuellen(710001)"
      )}`,
      // dieselbe Kennung zweimal auf einer Seite
      `${schuelerRow("710001", 1)}${schuelerRow("710001", 2)}`,
      // sichtbare Zeile mit drei statt vier Spalten
      `<tr><td>1</td><td>Vorname</td><td>Name</td></tr>${schuelerIdentifierRow(
        "710001"
      )}`
    ];

    for (const rows of invalidRows) {
      const body = paginatedListPage({
        area: "schueler",
        currentOffset: 0,
        offsets: [0],
        rows
      });
      const pages = new Map([
        ["/index.php?show=schueler&todo=&offset=0", { body }]
      ]);
      await expect(
        clientForPaginatedPages(pages).extractSafeArea(
          {
            email: "service-account@example.invalid",
            password: "synthetic-password"
          },
          "schueler"
        )
      ).rejects.toMatchObject({
        code: "matool_paginated_list_schema_mismatch",
        status: 502
      });
    }
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

  it("verwirft eine leere Zwischenseite statt sie als vollstaendig zu ersetzen", async () => {
    const offsets = [0, 30];
    const pages = new Map<string, { body: string }>([
      [
        "/index.php?show=schueler&todo=&offset=0",
        {
          body: paginatedListPage({
            area: "schueler",
            currentOffset: 0,
            offsets,
            rows: schuelerRow("710001", 1)
          })
        }
      ],
      [
        "/index.php?show=schueler&todo=&offset=30",
        {
          body: paginatedListPage({
            area: "schueler",
            currentOffset: 30,
            offsets,
            rows: ""
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
        "schueler"
      )
    ).rejects.toMatchObject({
      code: "matool_paginated_list_schema_mismatch",
      status: 502
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

  it("liest alle Klassen-Griffe und speichert alle bestaetigten Klassendaten mit stabiler Antwort-ID", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const page = `
      <html><body>
        <div id="klassengrafik_90000000001"
             onclick="formular_fuellen('90000000001')"></div>
        <div onclick=" formular_fuellen('90000000002') ; "></div>
        <div onclick="unrelated_handler('90000000003')"></div>
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
    expect(result.records[0]?.payload).toMatchObject({
      liveLink: "PRIVATE-LIVE-LINK",
      schueler_liste_sms: "PRIVATE-SMS-LIST",
      sms30Text: "PRIVATE-SMS-TEXT"
    });
    expect(result.records[0]?.payload.schuelerliste).toContain(
      "PRIVATE-STUDENT-ID"
    );

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

  it("verwirft mehrdeutige oder ungueltige Klassen-Griffe vor jedem Detailabruf", async () => {
    for (const page of [
      `<html><body>
         <div onclick="formular_fuellen('90000000001')"></div>
         <div onclick="formular_fuellen('90000000001')"></div>
       </body></html>`,
      `<html><body>
         <span onclick="formular_fuellen('90000000001')"></span>
       </body></html>`
    ]) {
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
        client.extractKlassen({
          email: "service-account@example.invalid",
          password: "synthetic-password"
        })
      ).rejects.toMatchObject({
        code: "matool_klassen_schema_mismatch",
        status: 502
      });
    }
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
