import { AppError } from "../core/app-error";
import { canonicalJson, sha256Hex } from "../core/crypto";
import { RunCookieJar } from "./cookie-jar";

const ALLOWED_MATOOL_HOST = "core.matool.de";
const MAX_PROBE_BYTES = 2_000_000;
const MAX_DISCOVERY_TABLES = 250;
const MAX_HEADERS_PER_TABLE = 100;
const MAX_ID_PATTERNS = 100;
const MAX_FIELDS = 100;
const MAX_STRUCTURE_TEXT_LENGTH = 200;
const MAX_INTERESSENTEN_RECORDS = 500;
const MAX_INTERESSENTEN_CELL_LENGTH = 150;
const MAX_INTERESSENTEN_ID_LENGTH = 32;
const MAX_SAFE_AREA_RECORDS = 20_000;
const MAX_SAFE_AREA_CELLS = 64;
const MAX_SAFE_AREA_CELL_LENGTH = 500;
const ALLOWED_DISCOVERY_AREAS = new Set(["interessenten"]);
const SAFE_MATOOL_AREAS = [
  "archiv",
  "artikel",
  "berichte",
  "checkin",
  "interessenten",
  "karte",
  "klassen",
  "lager",
  "newsletter",
  "pruefungen",
  "schueler",
  "telemetrie"
] as const;
const SAFE_MATOOL_AREA_SET = new Set<string>(SAFE_MATOOL_AREAS);
const INTERESSENTEN_HEADERS = [
  "Nr.",
  "Datum",
  "Vorname",
  "Name",
  "Status"
] as const;

export interface MatoolCredentials {
  email: string;
  password: string;
}

export interface InteressentenProbeResult {
  bodyBytes: number;
  contentType: string;
  cookieNames: string[];
  interestMarkerDetected: boolean;
  loginFormDetected: boolean;
  rowMarkerCount: number;
  status: number;
}

export interface MatoolInteressent {
  sourceId: string;
  displayNumber: string;
  createdDate: string;
  firstName: string;
  lastName: string;
  status: string;
}

export type MatoolArea = "interessenten";
export type MatoolSafeArea = (typeof SAFE_MATOOL_AREAS)[number];

export interface MatoolSafeAreaRecord {
  payload: Record<string, string | number>;
  sourceId: string;
}

export interface MatoolSafeAreaResult {
  area: MatoolSafeArea;
  bodyBytes: number;
  records: MatoolSafeAreaRecord[];
  rowCount: number;
}

export interface MatoolStructureDiscoveryResult {
  bereich: MatoolArea;
  bodyBytes: number;
  rowCount: number;
  status: number;
  tableCount: number;
  tables: Array<{
    headers: string[];
    index: number;
    rowCount: number;
  }>;
  idPatterns: Array<{
    attribute: "href" | "id" | "onclick";
    occurrences: number;
    pattern: string;
  }>;
  fields: Array<{
    element: "input" | "select";
    name: string;
    optionCount?: number;
    type?: string;
  }>;
}

export class MatoolClient {
  readonly #baseUrl: URL;
  readonly #cookies = new RunCookieJar();
  readonly #fetch: typeof fetch;
  #authenticated = false;

  constructor(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = validateMatoolBaseUrl(baseUrl);
    // Ohne Bindung an globalThis wirft der echte Worker-fetch
    // "Illegal invocation", sobald er als Objektfeld aufgerufen wird.
    // Mocks aus den Tests bleiben davon unberührt.
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async probeInteressenten(
    credentials: MatoolCredentials
  ): Promise<InteressentenProbeResult> {
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.request("/index.php?show=interessenten", {
      headers: {
        Accept: "text/html,application/xhtml+xml"
      },
      method: "GET"
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_status",
        502,
        "MATOOL hat für die Interessentenansicht einen unerwarteten Status geliefert."
      );
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_content_type",
        502,
        "MATOOL hat für die Interessentenansicht kein HTML geliefert."
      );
    }

    const declaredLength = Number(
      response.headers.get("Content-Length") ?? "0"
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_PROBE_BYTES
    ) {
      throw new AppError(
        "matool_response_too_large",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Probe-Limit."
      );
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_PROBE_BYTES) {
      throw new AppError(
        "matool_response_too_large",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Probe-Limit."
      );
    }

    const text = new TextDecoder().decode(body);
    const loginFormDetected =
      /name\s*=\s*["']mail["']/iu.test(text) &&
      /name\s*=\s*["']pass["']/iu.test(text);
    const interestMarkerDetected = /interessent/iu.test(text);

    if (loginFormDetected || !interestMarkerDetected) {
      throw new AppError(
        "matool_authentication_unverified",
        502,
        "Die angemeldete MATOOL-Interessentenansicht konnte nicht bestätigt werden."
      );
    }

    return {
      bodyBytes: body.byteLength,
      contentType,
      cookieNames: this.#cookies.names(),
      interestMarkerDetected,
      loginFormDetected,
      rowMarkerCount: (text.match(/<tr\b/giu) ?? []).length,
      status: response.status
    };
  }

  async discoverStructure(
    credentials: MatoolCredentials,
    bereich: string
  ): Promise<MatoolStructureDiscoveryResult> {
    const allowedArea = requireAllowedDiscoveryArea(bereich);
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.request(
      `/index.php?show=${encodeURIComponent(allowedArea)}`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml"
        },
        method: "GET"
      }
    );

    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_status",
        502,
        "MATOOL hat für die angeforderte Ansicht einen unerwarteten Status geliefert."
      );
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_content_type",
        502,
        "MATOOL hat für die angeforderte Ansicht kein HTML geliefert."
      );
    }

    const body = await readBoundedBody(response);
    const structure = await inspectStructure(body, contentType);
    if (structure.loginFormDetected || !structure.areaMarkerDetected) {
      throw new AppError(
        "matool_authentication_unverified",
        502,
        "Die angemeldete MATOOL-Ansicht konnte nicht bestätigt werden."
      );
    }

    return {
      bereich: allowedArea,
      bodyBytes: body.byteLength,
      rowCount: structure.rowCount,
      status: response.status,
      tableCount: structure.tableCount,
      tables: structure.tables,
      idPatterns: structure.idPatterns,
      fields: structure.fields
    };
  }

  async extractInteressenten(
    credentials: MatoolCredentials
  ): Promise<MatoolInteressent[]> {
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.request("/index.php?show=interessenten", {
      headers: {
        Accept: "text/html,application/xhtml+xml"
      },
      method: "GET"
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_status",
        502,
        "MATOOL hat fuer die Interessentenansicht einen unerwarteten Status geliefert."
      );
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_content_type",
        502,
        "MATOOL hat fuer die Interessentenansicht kein HTML geliefert."
      );
    }

    return extractInteressentenFromHtml(
      await readBoundedBody(response),
      contentType
    );
  }

  async extractSafeArea(
    credentials: MatoolCredentials,
    area: string
  ): Promise<MatoolSafeAreaResult> {
    const allowedArea = requireAllowedSafeArea(area);
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.request(
      `/index.php?show=${encodeURIComponent(allowedArea)}`,
      {
        headers: { Accept: "text/html,application/xhtml+xml" },
        method: "GET"
      }
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_status",
        502,
        "MATOOL hat für die angeforderte Ansicht einen unerwarteten Status geliefert."
      );
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new AppError(
        "matool_unexpected_content_type",
        502,
        "MATOOL hat für die angeforderte Ansicht kein HTML geliefert."
      );
    }

    const body = await readBoundedBody(response);
    const records = await extractSafeAreaRows(
      body,
      contentType,
      allowedArea
    );
    return {
      area: allowedArea,
      bodyBytes: body.byteLength,
      records,
      rowCount: records.length
    };
  }

  clearSession(): void {
    this.#cookies.clear();
    this.#authenticated = false;
  }

  private async login(credentials: MatoolCredentials): Promise<void> {
    // Ein Lauf meldet sich genau einmal an; alle weiteren Bereiche
    // verwenden dieselbe Session und dasselbe Subrequest-Budget.
    if (this.#authenticated) {
      return;
    }
    await this.performLogin(credentials);
    this.#authenticated = true;
  }

  private async performLogin(
    credentials: MatoolCredentials
  ): Promise<void> {
    const primeResponse = await this.request("/index.php", {
      headers: {
        Accept: "text/html,application/xhtml+xml"
      },
      method: "GET"
    });
    if (!primeResponse.ok) {
      await primeResponse.body?.cancel();
      throw new AppError(
        "matool_session_prime_failed",
        502,
        "Die MATOOL-Sitzung konnte nicht initialisiert werden."
      );
    }
    await primeResponse.body?.cancel();

    const body = new URLSearchParams({
      mail: credentials.email,
      pass: credentials.password
    });
    const response = await this.request("/index.php", {
      body,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });

    if (response.status < 200 || response.status >= 400) {
      await response.body?.cancel();
      throw new AppError(
        "matool_login_failed",
        502,
        "Die MATOOL-Anmeldung ist fehlgeschlagen."
      );
    }

    // MATOOL beantwortet falsche Zugangsdaten mit HTTP 200 und der
    // Loginseite, nicht mit 401 oder 403. Ohne diese Prüfung würde der
    // Collector anschliessend die Loginseite parsen.
    const landingPage = await response.text();
    if (
      /name\s*=\s*["']mail["']/iu.test(landingPage) &&
      /name\s*=\s*["']pass["']/iu.test(landingPage)
    ) {
      throw new AppError(
        "matool_login_failed",
        502,
        "Die MATOOL-Anmeldung ist fehlgeschlagen."
      );
    }
  }

  private async request(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    let url = new URL(path, this.#baseUrl);
    assertAllowedMatoolUrl(url);

    let method = init.method ?? "GET";
    let body: BodyInit | null = init.body ?? null;
    const headers = new Headers(init.headers);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const cookie = this.#cookies.headerValue();
      if (cookie) {
        headers.set("Cookie", cookie);
      } else {
        headers.delete("Cookie");
      }

      headers.set("Origin", this.#baseUrl.origin);
      headers.set("Referer", `${this.#baseUrl.origin}/index.php`);

      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          body,
          headers,
          method,
          redirect: "manual",
          signal: init.signal ?? AbortSignal.timeout(15_000)
        });
      } catch (error) {
        // Technische Ursache protokollieren: Ein Verbindungsfehler enthält
        // weder Zugangsdaten noch Personendaten, ist zur Abgrenzung von
        // Sperre, Zeitüberschreitung und TLS-Problem aber notwendig.
        const cause = error as Error;
        console.error(
          JSON.stringify({
            event: "matool_fetch_failed",
            host: url.hostname,
            method,
            name: cause?.name ?? "unknown",
            reason: cause?.message ?? "unknown"
          })
        );
        throw new AppError(
          "matool_network_error",
          502,
          "MATOOL konnte für die read-only-Probe nicht erreicht werden."
        );
      }
      this.#cookies.absorb(response.headers);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("Location");
      if (!location) {
        throw new AppError(
          "matool_invalid_redirect",
          502,
          "MATOOL hat einen Redirect ohne Ziel geliefert."
        );
      }

      if (redirectCount === 3) {
        throw new AppError(
          "matool_redirect_limit",
          502,
          "MATOOL hat zu viele Redirects geliefert."
        );
      }

      const nextUrl = new URL(location, url);
      await response.body?.cancel();
      assertAllowedMatoolUrl(nextUrl);

      if (response.status === 307 || response.status === 308) {
        throw new AppError(
          "matool_unsafe_redirect",
          502,
          "Ein potenziell unsicherer MATOOL-Redirect wurde abgebrochen."
        );
      }

      url = nextUrl;
      method = "GET";
      body = null;
      headers.delete("Content-Type");
    }

    throw new AppError(
      "matool_redirect_limit",
      502,
      "MATOOL hat zu viele Redirects geliefert."
    );
  }
}

interface SafeAreaRowCapture {
  cells: string[];
  hrefIds: Array<{ id: string; key: string }>;
  linkCount: number;
  onclickIds: string[];
  tableIndex: number;
  tdCount: number;
  thCount: number;
}

async function extractSafeAreaRows(
  body: Uint8Array,
  contentType: string,
  area: MatoolSafeArea
): Promise<MatoolSafeAreaRecord[]> {
  const rows: SafeAreaRowCapture[] = [];
  const tableStack: number[] = [];
  let tableCount = 0;
  let activeRow: SafeAreaRowCapture | undefined;
  let activeCell:
    | { ignoredDepth: number; row: SafeAreaRowCapture; text: string }
    | undefined;
  let mailFieldDetected = false;
  let passwordFieldDetected = false;

  const startCell = (kind: "td" | "th"): void => {
    if (!activeRow || activeRow.cells.length >= MAX_SAFE_AREA_CELLS) {
      activeCell = undefined;
      return;
    }
    if (kind === "td") {
      activeRow.tdCount += 1;
    } else {
      activeRow.thCount += 1;
    }
    activeCell = { ignoredDepth: 0, row: activeRow, text: "" };
  };
  const endCell = (): void => {
    if (!activeCell) {
      return;
    }
    activeCell.row.cells.push(activeCell.text);
    activeCell = undefined;
  };
  const appendText = (value: string): void => {
    if (activeCell && activeCell.ignoredDepth === 0) {
      activeCell.text = appendBounded(
        activeCell.text,
        value,
        MAX_SAFE_AREA_CELL_LENGTH
      );
    }
  };

  const rewriter = new HTMLRewriter()
    .on("table", {
      element(element) {
        tableStack.push(tableCount);
        tableCount += 1;
        element.onEndTag(() => {
          tableStack.pop();
        });
      }
    })
    .on("table tr", {
      element(element) {
        const row: SafeAreaRowCapture = {
          cells: [],
          hrefIds: [],
          linkCount: 0,
          onclickIds: [],
          tableIndex: tableStack.at(-1) ?? -1,
          tdCount: 0,
          thCount: 0
        };
        activeRow = row;
        rows.push(row);
        element.onEndTag(() => {
          if (activeRow === row) {
            activeRow = undefined;
          }
        });
      }
    })
    .on("table td", {
      element(element) {
        startCell("td");
        element.onEndTag(endCell);
      },
      text(text) {
        appendText(text.text);
      }
    })
    .on("table th", {
      element(element) {
        startCell("th");
        element.onEndTag(endCell);
      },
      text(text) {
        appendText(text.text);
      }
    })
    .on("table a[href]", {
      element(element) {
        if (!activeRow) {
          return;
        }
        activeRow.linkCount += 1;
        const href = element.getAttribute("href") ?? "";
        let url: URL;
        try {
          url = new URL(
            href.replace(/&amp;/giu, "&"),
            "https://core.matool.de"
          );
        } catch {
          return;
        }
        for (const key of ["id", "interessent", "schueler", "artikel"]) {
          const id = url.searchParams.get(key) ?? "";
          if (/^\d{1,64}$/u.test(id)) {
            activeRow.hrefIds.push({ id, key });
          }
        }
      }
    })
    .on("table [onclick]", {
      element(element) {
        if (!activeRow) {
          return;
        }
        const match =
          /^\s*(?:formular_fuellen|open\w*|show\w*|load\w*|edit\w*|.*(?:daten|detail)\w*)\s*\(\s*['"]?(\d{1,64})/iu.exec(
            element.getAttribute("onclick") ?? ""
          );
        if (match?.[1]) {
          activeRow.onclickIds.push(match[1]);
        }
      }
    })
    .on("input", {
      element(element) {
        const name = element.getAttribute("name")?.trim().toLowerCase();
        mailFieldDetected ||= name === "mail";
        passwordFieldDetected ||= name === "pass";
      }
    })
    .on("table script", {
      element(element) {
        const cell = activeCell;
        if (cell) {
          cell.ignoredDepth += 1;
          element.onEndTag(() => {
            cell.ignoredDepth -= 1;
          });
        }
      }
    })
    .on("table style", {
      element(element) {
        const cell = activeCell;
        if (cell) {
          cell.ignoredDepth += 1;
          element.onEndTag(() => {
            cell.ignoredDepth -= 1;
          });
        }
      }
    })
    .on("table template", {
      element(element) {
        const cell = activeCell;
        if (cell) {
          cell.ignoredDepth += 1;
          element.onEndTag(() => {
            cell.ignoredDepth -= 1;
          });
        }
      }
    });

  const transformed = rewriter.transform(
    new Response(body, { headers: { "Content-Type": contentType } })
  );
  await drainBody(transformed.body);

  if (mailFieldDetected && passwordFieldDetected) {
    throw new AppError(
      "matool_authentication_unverified",
      502,
      "Die angemeldete MATOOL-Ansicht konnte nicht bestätigt werden."
    );
  }

  const prepared: Array<{
    explicitId?: string;
    payload: Record<string, string | number>;
  }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.cells.length === 0 || row.tdCount === 0) {
      continue;
    }
    const cells = row.cells.map(normalizeSafeAreaCell);
    if (
      cells.every((cell) => cell.length === 0) ||
      (cells.length === 1 &&
        row.linkCount > 0 &&
        row.hrefIds.length === 0 &&
        row.onclickIds.length === 0)
    ) {
      continue;
    }
    const payload: Record<string, string | number> = {
      columnCount: cells.length,
      tableIndex: row.tableIndex
    };
    cells.forEach((cell, index) => {
      payload[`c${index.toString().padStart(2, "0")}`] = cell;
    });
    const explicitId = selectSafeAreaSourceId(row, area);
    const rowKey = explicitId
      ? `id:${explicitId}`
      : `payload:${canonicalJson(payload)}`;
    if (seen.has(rowKey)) {
      continue;
    }
    seen.add(rowKey);
    if (prepared.length >= MAX_SAFE_AREA_RECORDS) {
      throw new AppError(
        "matool_safe_area_limit_exceeded",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Datensatzlimit."
      );
    }
    prepared.push({ ...(explicitId ? { explicitId } : {}), payload });
  }

  return Promise.all(
    prepared.map(async ({ explicitId, payload }) => ({
      payload,
      sourceId:
        explicitId ?? (await sha256Hex(canonicalJson(payload)))
    }))
  );
}

function selectSafeAreaSourceId(
  row: SafeAreaRowCapture,
  area: MatoolSafeArea
): string | undefined {
  const areaKey =
    area === "interessenten"
      ? "interessent"
      : area === "schueler" || area === "artikel"
        ? area
        : "id";
  for (const key of [areaKey, "id", "interessent", "schueler", "artikel"]) {
    const ids = new Set(
      row.hrefIds
        .filter((candidate) => candidate.key === key)
        .map((candidate) => candidate.id)
    );
    if (ids.size === 1) {
      return ids.values().next().value;
    }
  }
  const onclickIds = new Set(row.onclickIds);
  return onclickIds.size === 1
    ? onclickIds.values().next().value
    : undefined;
}

function normalizeSafeAreaCell(value: string): string {
  const normalized = value
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_SAFE_AREA_CELL_LENGTH);
  return /[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}/iu.test(normalized)
    ? ""
    : normalized;
}

interface InteressentenRowCapture {
  cells: string[];
  formIds: string[];
  header: boolean;
  invalidIdentifier: boolean;
  linkIds: string[];
  tableIndex: number;
}

async function extractInteressentenFromHtml(
  body: Uint8Array,
  contentType: string
): Promise<MatoolInteressent[]> {
  const rows: InteressentenRowCapture[] = [];
  const tableStack: number[] = [];
  let tableCount = 0;
  let activeRow: InteressentenRowCapture | undefined;
  let activeCell:
    | {
        row: InteressentenRowCapture;
        text: string;
      }
    | undefined;

  const rewriter = new HTMLRewriter()
    .on("table", {
      element(element) {
        const tableIndex = tableCount;
        tableCount += 1;
        tableStack.push(tableIndex);
        element.onEndTag(() => {
          tableStack.pop();
        });
      }
    })
    .on("tr", {
      element(element) {
        const row: InteressentenRowCapture = {
          cells: [],
          formIds: [],
          header: false,
          invalidIdentifier: false,
          linkIds: [],
          tableIndex: tableStack.at(-1) ?? -1
        };
        activeRow = row;
        rows.push(row);
        element.onEndTag(() => {
          if (activeRow === row) {
            activeRow = undefined;
          }
        });
      }
    })
    .on("tr.master_tab_tr_head", {
      element() {
        if (activeRow) {
          activeRow.header = true;
        }
      }
    })
    .on("tr td", {
      element(element) {
        if (!activeRow) {
          return;
        }
        const capture = { row: activeRow, text: "" };
        activeCell = capture;
        element.onEndTag(() => {
          capture.row.cells.push(capture.text);
          if (activeCell === capture) {
            activeCell = undefined;
          }
        });
      },
      text(text) {
        if (activeCell) {
          activeCell.text = appendBounded(
            activeCell.text,
            text.text,
            MAX_INTERESSENTEN_CELL_LENGTH + 1
          );
        }
      }
    })
    .on("[onclick]", {
      element(element) {
        if (!activeRow) {
          return;
        }
        const value = element.getAttribute("onclick") ?? "";
        if (!value.includes("formular_fuellen")) {
          return;
        }
        const matches = [
          ...value.matchAll(
            /\bformular_fuellen\s*\(\s*(\d{1,32})\s*\)/gu
          )
        ];
        if (matches.length !== 1) {
          activeRow.invalidIdentifier = true;
          return;
        }
        activeRow.formIds.push(matches[0]?.[1] ?? "");
      }
    })
    .on("a[href]", {
      element(element) {
        if (!activeRow) {
          return;
        }
        const rawHref = element.getAttribute("href") ?? "";
        let url: URL;
        try {
          url = new URL(
            rawHref.replace(/&amp;/giu, "&"),
            "https://core.matool.de"
          );
        } catch {
          return;
        }
        if (
          url.searchParams.get("show") !== "schueler" ||
          url.searchParams.get("todo") !== "3"
        ) {
          return;
        }
        const sourceId = url.searchParams.get("interessent") ?? "";
        if (!/^\d{1,32}$/u.test(sourceId)) {
          activeRow.invalidIdentifier = true;
          return;
        }
        activeRow.linkIds.push(sourceId);
      }
    });

  const transformed = rewriter.transform(
    new Response(body, {
      headers: {
        "Content-Type": contentType
      }
    })
  );
  await drainBody(transformed.body);

  const headerRows = rows.filter((row) => row.header);
  if (
    headerRows.length !== 1 ||
    !sameStrings(
      headerRows[0]?.cells.map(normalizeInteressentenCell) ?? [],
      INTERESSENTEN_HEADERS
    )
  ) {
    throw interessentenSchemaError();
  }

  const tableIndex = headerRows[0]?.tableIndex;
  const dataRows = rows.filter(
    (row) =>
      !row.header &&
      row.tableIndex === tableIndex &&
      row.cells.length > 0
  );
  if (dataRows.length > MAX_INTERESSENTEN_RECORDS) {
    throw interessentenSchemaError();
  }

  // Reine Struktur-Kennzahlen zur Fehlersuche: keine Zellinhalte,
  // keine Personendaten.
  const rowsPerTable = new Map<number, number>();
  for (const row of rows) {
    rowsPerTable.set(row.tableIndex, (rowsPerTable.get(row.tableIndex) ?? 0) + 1);
  }
  console.info(
    JSON.stringify({
      event: "matool_interessenten_structure",
      bodyBytes: body.byteLength,
      dataRowCount: dataRows.length,
      headerTableIndex: tableIndex,
      rowsPerTable: Object.fromEntries(rowsPerTable),
      totalRowCount: rows.length
    })
  );

  const seenSourceIds = new Set<string>();
  const seenDisplayNumbers = new Set<string>();
  const records: MatoolInteressent[] = [];
  for (const row of dataRows) {
    const cells = row.cells.map(normalizeInteressentenCell);
    const sourceId = row.formIds[0] ?? "";
    const displayNumber = cells[0] ?? "";
    if (
      row.invalidIdentifier ||
      cells.length !== INTERESSENTEN_HEADERS.length ||
      cells.some((cell) => cell.length === 0) ||
      row.formIds.length !== 1 ||
      row.linkIds.length !== 1 ||
      sourceId !== row.linkIds[0] ||
      sourceId.length > MAX_INTERESSENTEN_ID_LENGTH ||
      !/^\d+$/u.test(displayNumber) ||
      seenSourceIds.has(sourceId) ||
      seenDisplayNumbers.has(displayNumber)
    ) {
      throw interessentenSchemaError();
    }
    seenSourceIds.add(sourceId);
    seenDisplayNumbers.add(displayNumber);
    records.push({
      sourceId,
      displayNumber,
      createdDate: cells[1] ?? "",
      firstName: cells[2] ?? "",
      lastName: cells[3] ?? "",
      status: cells[4] ?? ""
    });
  }

  return records;
}

function normalizeInteressentenCell(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length > MAX_INTERESSENTEN_CELL_LENGTH) {
    throw interessentenSchemaError();
  }
  return normalized;
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function interessentenSchemaError(): AppError {
  return new AppError(
    "matool_interessenten_schema_mismatch",
    502,
    "Die MATOOL-Interessentenstruktur entspricht nicht dem freigegebenen Schema."
  );
}

interface StructureInspection {
  areaMarkerDetected: boolean;
  fields: MatoolStructureDiscoveryResult["fields"];
  idPatterns: MatoolStructureDiscoveryResult["idPatterns"];
  loginFormDetected: boolean;
  rowCount: number;
  tableCount: number;
  tables: MatoolStructureDiscoveryResult["tables"];
}

type DiscoveredTable = MatoolStructureDiscoveryResult["tables"][number];
type DiscoveredField = MatoolStructureDiscoveryResult["fields"][number];
type DiscoveredIdPattern =
  MatoolStructureDiscoveryResult["idPatterns"][number];

function requireAllowedDiscoveryArea(bereich: string): MatoolArea {
  if (!ALLOWED_DISCOVERY_AREAS.has(bereich)) {
    throw new AppError(
      "matool_area_not_allowed",
      400,
      "Dieser MATOOL-Bereich ist für die Strukturerkennung nicht freigegeben."
    );
  }
  return bereich as MatoolArea;
}

function requireAllowedSafeArea(area: string): MatoolSafeArea {
  if (!SAFE_MATOOL_AREA_SET.has(area)) {
    throw new AppError(
      "matool_area_not_allowed",
      400,
      "Dieser MATOOL-Bereich ist für den read-only-Abruf nicht freigegeben."
    );
  }
  return area as MatoolSafeArea;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      Number.isFinite(parsedLength) &&
      parsedLength > MAX_PROBE_BYTES
    ) {
      await response.body?.cancel();
      throw responseTooLargeError();
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (bodyBytes + value.byteLength > MAX_PROBE_BYTES) {
        await reader.cancel();
        throw responseTooLargeError();
      }
      chunks.push(value);
      bodyBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function responseTooLargeError(): AppError {
  return new AppError(
    "matool_response_too_large",
    502,
    "Die MATOOL-Antwort überschreitet das sichere Probe-Limit."
  );
}

async function inspectStructure(
  body: Uint8Array,
  contentType: string
): Promise<StructureInspection> {
  const tables: DiscoveredTable[] = [];
  const activeTables: Array<DiscoveredTable | undefined> = [];
  const idPatterns: DiscoveredIdPattern[] = [];
  const idPatternByKey = new Map<string, DiscoveredIdPattern>();
  const fields: DiscoveredField[] = [];
  const fieldIndexByKey = new Map<string, number>();
  const activeSelects: Array<{
    fieldIndex: number | undefined;
    optionCount: number;
  }> = [];

  let tableCount = 0;
  let rowCount = 0;
  let activeHeader:
    | {
        table: DiscoveredTable;
        text: string;
      }
    | undefined;
  let areaMarkerDetected = false;
  let markerTail = "";
  let mailFieldDetected = false;
  let passwordFieldDetected = false;

  const upsertField = (field: DiscoveredField): number | undefined => {
    const key = `${field.element}\u0000${field.name}\u0000${field.type ?? ""}`;
    const existingIndex = fieldIndexByKey.get(key);
    if (existingIndex !== undefined) {
      return existingIndex;
    }
    if (fields.length >= MAX_FIELDS) {
      return undefined;
    }
    const index = fields.length;
    fields.push(field);
    fieldIndexByKey.set(key, index);
    return index;
  };

  const recordPattern = (
    attribute: DiscoveredIdPattern["attribute"],
    rawValue: string | null
  ): void => {
    if (!rawValue) {
      return;
    }
    const pattern = deriveIdPattern(attribute, rawValue);
    if (!pattern) {
      return;
    }
    const key = `${attribute}\u0000${pattern}`;
    const existing = idPatternByKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    if (idPatterns.length >= MAX_ID_PATTERNS) {
      return;
    }
    const discovered: DiscoveredIdPattern = {
      attribute,
      occurrences: 1,
      pattern
    };
    idPatterns.push(discovered);
    idPatternByKey.set(key, discovered);
  };

  const rewriter = new HTMLRewriter()
    .on("body", {
      text(text) {
        const markerWindow = `${markerTail}${text.text}`;
        if (/interessent/iu.test(markerWindow)) {
          areaMarkerDetected = true;
        }
        markerTail = markerWindow.slice(-32);
      }
    })
    .on("table", {
      element(element) {
        const index = tableCount;
        tableCount += 1;
        const table =
          index < MAX_DISCOVERY_TABLES
            ? {
                headers: [],
                index,
                rowCount: 0
              }
            : undefined;
        if (table) {
          tables.push(table);
        }
        activeTables.push(table);
        element.onEndTag(() => {
          activeTables.pop();
        });
      }
    })
    .on("table tr", {
      element() {
        rowCount += 1;
        const table = activeTables.at(-1);
        if (table) {
          table.rowCount += 1;
        }
      }
    })
    .on("table th", {
      element(element) {
        const table = activeTables.at(-1);
        if (!table || table.headers.length >= MAX_HEADERS_PER_TABLE) {
          activeHeader = undefined;
          return;
        }
        const capture = { table, text: "" };
        activeHeader = capture;
        element.onEndTag(() => {
          if (activeHeader === capture) {
            table.headers.push(normalizeStructureText(capture.text));
            activeHeader = undefined;
          }
        });
      },
      text(text) {
        if (activeHeader) {
          activeHeader.text = appendBounded(
            activeHeader.text,
            text.text,
            MAX_STRUCTURE_TEXT_LENGTH * 2
          );
        }
      }
    })
    .on("[id]", {
      element(element) {
        recordPattern("id", element.getAttribute("id"));
      }
    })
    .on("[href]", {
      element(element) {
        recordPattern("href", element.getAttribute("href"));
      }
    })
    .on("[onclick]", {
      element(element) {
        recordPattern("onclick", element.getAttribute("onclick"));
      }
    })
    .on("input", {
      element(element) {
        const rawName = element.getAttribute("name")?.trim() ?? "";
        if (rawName.toLowerCase() === "mail") {
          mailFieldDetected = true;
        }
        if (rawName.toLowerCase() === "pass") {
          passwordFieldDetected = true;
        }
        const name = sanitizeFieldName(rawName);
        if (!name) {
          return;
        }
        upsertField({
          element: "input",
          name,
          type: sanitizeInputType(element.getAttribute("type"))
        });
      }
    })
    .on("select", {
      element(element) {
        const name = sanitizeFieldName(
          element.getAttribute("name")?.trim() ?? ""
        );
        const fieldIndex = name
          ? upsertField({
              element: "select",
              name,
              optionCount: 0
            })
          : undefined;
        const capture = { fieldIndex, optionCount: 0 };
        activeSelects.push(capture);
        element.onEndTag(() => {
          activeSelects.pop();
          if (capture.fieldIndex === undefined) {
            return;
          }
          const field = fields[capture.fieldIndex];
          if (field?.element === "select") {
            field.optionCount = Math.max(
              field.optionCount ?? 0,
              capture.optionCount
            );
          }
        });
      }
    })
    .on("select option", {
      element() {
        const select = activeSelects.at(-1);
        if (select) {
          select.optionCount += 1;
        }
      }
    });

  const transformed = rewriter.transform(
    new Response(body, {
      headers: {
        "Content-Type": contentType
      }
    })
  );
  await drainBody(transformed.body);

  return {
    areaMarkerDetected,
    fields,
    idPatterns,
    loginFormDetected: mailFieldDetected && passwordFieldDetected,
    rowCount,
    tableCount,
    tables
  };
}

async function drainBody(
  body: ReadableStream<Uint8Array> | null
): Promise<void> {
  if (!body) {
    return;
  }
  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      // Consuming the transformed stream drives HTMLRewriter without
      // retaining a second copy of the MATOOL page.
    }
  } finally {
    reader.releaseLock();
  }
}

function deriveIdPattern(
  attribute: DiscoveredIdPattern["attribute"],
  rawValue: string
): string | undefined {
  if (attribute === "onclick") {
    return deriveCallPattern(rawValue);
  }
  if (attribute === "href") {
    return deriveHrefPattern(rawValue);
  }
  return deriveDynamicTemplate(rawValue);
}

function deriveDynamicTemplate(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  let changed = false;
  const pattern = trimmed
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      () => {
        changed = true;
        return "{uuid}";
      }
    )
    .replace(/\b[0-9a-f]{12,}\b/giu, () => {
      changed = true;
      return "{hex}";
    })
    .replace(/\d+/gu, () => {
      changed = true;
      return "{number}";
    });

  return changed ? capPatternText(pattern) : undefined;
}

function deriveHrefPattern(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^javascript:/iu.test(trimmed)) {
    return deriveCallPattern(trimmed.replace(/^javascript:\s*/iu, ""));
  }

  let url: URL;
  try {
    url = new URL(trimmed, "https://core.matool.de");
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const pathSegments = url.pathname.split("/");
  let idSignalDetected = pathSegments.some(
    (segment) => deriveDynamicTemplate(segment) !== undefined
  );
  const queryParts: string[] = [];
  let queryCount = 0;
  for (const [rawKey, value] of url.searchParams) {
    if (queryCount >= 20) {
      break;
    }
    queryCount += 1;
    const key = sanitizeFieldName(rawKey);
    if (!key) {
      continue;
    }
    if (/(?:^|[_\[])(?:id|uid)(?:$|[_\]])|interessent/iu.test(rawKey)) {
      idSignalDetected = true;
    }
    queryParts.push(`${key}=${classifyTemplateValue(value)}`);
  }

  if (!idSignalDetected) {
    return undefined;
  }
  const path = sanitizeHrefPath(url.pathname);
  return capPatternText(
    `${path}${queryParts.length > 0 ? `?${queryParts.join("&")}` : ""}`
  );
}

function sanitizeHrefPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment || segment === "index.php") {
        return segment;
      }
      return deriveDynamicTemplate(segment) ?? "{segment}";
    })
    .join("/");
}

function deriveCallPattern(rawValue: string): string | undefined {
  const match = /^\s*([A-Za-z_$][\w$]{0,127})\s*\(([\s\S]*)\)\s*;?\s*$/u.exec(
    rawValue
  );
  if (!match) {
    return undefined;
  }
  const rawArguments = splitCallArguments(match[2] ?? "");
  if (!rawArguments || rawArguments.length === 0) {
    return undefined;
  }
  const hasIdentifierCandidate = rawArguments.some((argument) =>
    isIdentifierCandidate(argument)
  );
  if (!hasIdentifierCandidate) {
    return undefined;
  }
  const functionName =
    deriveDynamicTemplate(match[1] ?? "") ?? (match[1] ?? "");
  const argumentsTemplate = rawArguments
    .slice(0, 20)
    .map(classifyCallArgument)
    .join(",");
  return capPatternText(`${functionName}(${argumentsTemplate})`);
}

function splitCallArguments(value: string): string[] | undefined {
  if (value.trim().length === 0) {
    return [];
  }
  const result: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) {
        return undefined;
      }
      continue;
    }
    if (character === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || depth !== 0) {
    return undefined;
  }
  result.push(value.slice(start).trim());
  return result;
}

function isIdentifierCandidate(argument: string): boolean {
  const value = argument.trim();
  return (
    /^['"`][\s\S]*['"`]$/u.test(value) ||
    /^-?\d+(?:\.\d+)?$/u.test(value) ||
    /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/iu.test(value)
  );
}

function classifyCallArgument(argument: string): string {
  const value = argument.trim();
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return "{number}";
  }
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(
      value
    )
  ) {
    return "{uuid}";
  }
  if (/^['"`][\s\S]*['"`]$/u.test(value)) {
    return "{string}";
  }
  return "{value}";
}

function classifyTemplateValue(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return "{number}";
  }
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    )
  ) {
    return "{uuid}";
  }
  return "{value}";
}

function sanitizeFieldName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return "";
  }
  return capStructureText(deriveDynamicTemplate(trimmed) ?? trimmed);
}

function sanitizeInputType(rawType: string | null): string {
  const type = (rawType ?? "text").trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,31}$/u.test(type) ? type : "other";
}

function appendBounded(
  current: string,
  addition: string,
  maxLength: number
): string {
  if (current.length >= maxLength) {
    return current;
  }
  return `${current}${addition}`.slice(0, maxLength);
}

function normalizeStructureText(value: string): string {
  return capStructureText(value.replace(/\s+/gu, " ").trim());
}

function capStructureText(value: string): string {
  return value.slice(0, MAX_STRUCTURE_TEXT_LENGTH);
}

function capPatternText(value: string): string {
  return value.length <= MAX_STRUCTURE_TEXT_LENGTH
    ? value
    : "{redacted-pattern}";
}

export function validateMatoolBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "invalid_matool_base_url",
      500,
      "Die MATOOL-Basisadresse ist ungültig."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_MATOOL_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      "invalid_matool_base_url",
      500,
      "Die MATOOL-Basisadresse ist nicht freigegeben."
    );
  }

  return url;
}

export function assertAllowedMatoolUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_MATOOL_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new AppError(
      "matool_redirect_blocked",
      502,
      "Ein MATOOL-Redirect zu einem nicht freigegebenen Ziel wurde blockiert."
    );
  }
}

function requireCredentials(credentials: MatoolCredentials): void {
  if (
    credentials.email.trim().length === 0 ||
    credentials.password.length === 0
  ) {
    throw new AppError(
      "matool_credentials_missing",
      500,
      "Die MATOOL-Zugangsdaten sind nicht vollständig konfiguriert."
    );
  }
}
