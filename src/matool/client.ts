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
const MAX_KLASSEN_RECORDS = 500;
const MAX_SAFE_AREA_RECORDS = 20_000;
const MAX_SAFE_AREA_PAGES = 250;
const MAX_SAFE_AREA_CELLS = 64;
const MAX_SAFE_AREA_CELL_LENGTH = 500;
const PAGINATED_SAFE_AREAS = new Set(["interessenten", "schueler"]);
// Detaildaten werden ausschliesslich ueber MATOOLs lesenden JSON-Endpunkt
// geladen. Die Grenze entspricht der maximal verarbeiteten Listenmenge.
const MAX_INTERESSENTEN_DETAIL_RECORDS = 500;
const MAX_INTERESSENTEN_DETAIL_HANDLES = 500;
const MAX_INTERESSENT_DETAIL_VALUE_LENGTH = 2_000;
const MAX_INTERESSENTEN_STATUS_ATTEMPTS = 3;
const MAX_INTERESSENTEN_RETRY_AFTER_MS = 5_000;
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
const INTERESSENTEN_SAFE_AREA_FIELDS = [
  "nr",
  "datum",
  "vorname",
  "name",
  "status"
] as const;
export const MATOOL_KLASSEN_PAYLOAD_FIELDS = [
  "alter_ende",
  "alter_start",
  "benutzer",
  "beschreibung",
  "bildDa",
  "endzeit_h",
  "endzeit_m",
  "freiklasse",
  "id",
  "id_schulintern",
  "kapazitaet",
  "klassenende",
  "klassenfarbe",
  "klassenstart",
  "kurzname",
  "online",
  "probetraining_kontingent",
  "raum",
  "schule",
  "sms30",
  "sparte",
  "startzeit_h",
  "startzeit_m",
  "teilnehmerMax",
  "wochentag"
] as const;
const KLASSEN_EXCLUDED_FIELDS = [
  "liveLink",
  "schueler_liste_sms",
  "schuelerliste",
  "sms30Text"
] as const;
const KLASSEN_RESPONSE_FIELDS = new Set<string>([
  ...MATOOL_KLASSEN_PAYLOAD_FIELDS,
  ...KLASSEN_EXCLUDED_FIELDS
]);

export interface MatoolCredentials {
  email: string;
  password: string;
}

export interface MatoolKlassenBatchOptions {
  maxRecords?: number;
  offset?: number;
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
type MatoolPaginatedSafeArea = "interessenten" | "schueler";

export interface MatoolSafeAreaRecord {
  payload: Record<string, boolean | number | string | null>;
  sourceId: string;
}

export interface MatoolSafeAreaResult {
  area: MatoolSafeArea | "interessenten_details";
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
  readonly #maxRequestCount: number;
  readonly #minRequestIntervalMs: number;
  #lastRequestFinishedAt = 0;
  #requestCount = 0;
  #authenticated = false;

  /** Anzahl der in diesem Client-Lauf versuchten MATOOL-Anfragen. */
  get requestCount(): number {
    return this.#requestCount;
  }

  /**
   * `minRequestIntervalMs` haelt einen Mindestabstand zwischen zwei
   * MATOOL-Anfragen ein. MATOOL beantwortet schnelle Anfragefolgen sonst
   * ab dem vierten Bereich mit Verbindungsabbruechen. Die Voreinstellung
   * ist 0, damit Tests ohne Wartezeit laufen; der Betrieb setzt den Wert
   * bewusst in `schedule.ts`.
   */
  constructor(
    baseUrl: string,
    fetchImplementation: typeof fetch = fetch,
    options: {
      maxRequestCount?: number;
      minRequestIntervalMs?: number;
    } = {}
  ) {
    this.#baseUrl = validateMatoolBaseUrl(baseUrl);
    // Ohne Bindung an globalThis wirft der echte Worker-fetch
    // "Illegal invocation", sobald er als Objektfeld aufgerufen wird.
    // Mocks aus den Tests bleiben davon unberührt.
    this.#fetch = fetchImplementation.bind(globalThis);
    this.#minRequestIntervalMs = Math.min(
      5_000,
      Math.max(0, Math.trunc(options.minRequestIntervalMs ?? 0))
    );
    this.#maxRequestCount = normalizeMaxRequestCount(
      options.maxRequestCount
    );
  }

  async probeInteressenten(
    credentials: MatoolCredentials
  ): Promise<InteressentenProbeResult> {
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.requestInteressentenWithStatusRetry(
      "/index.php?show=interessenten",
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

    const response = await this.requestInteressentenWithStatusRetry(
      "/index.php?show=interessenten",
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

    if (isPaginatedSafeArea(allowedArea)) {
      return this.extractPaginatedSafeArea(allowedArea);
    }

    return this.fetchSingleSafeAreaPage(allowedArea);
  }

  private async extractPaginatedSafeArea(
    area: MatoolPaginatedSafeArea
  ): Promise<MatoolSafeAreaResult> {
    // MATOOL merkt sich die zuletzt geoeffnete Seite in der Session.
    // Deshalb muss auch die erste Seite immer explizit offset=0 anfordern.
    const firstPage = await this.fetchSafeAreaPage(area, 0);
    const pagination = normalizeSafeAreaPagination(
      firstPage.pagination,
      area,
      0
    );
    validateSelectedPaginationPage(pagination, 0);

    const records = new Map<string, MatoolSafeAreaRecord>();
    let bodyBytes = firstPage.bodyBytes;
    mergePaginatedSafeAreaRecords(records, firstPage.records);

    for (const offset of pagination.offsets) {
      if (offset === 0) {
        continue;
      }
      const page = await this.fetchSafeAreaPage(area, offset);
      bodyBytes += page.bodyBytes;
      const pagePagination = normalizeSafeAreaPagination(
        page.pagination,
        area,
        offset
      );
      if (!sameNumbers(pagePagination.offsets, pagination.offsets)) {
        throw paginatedSafeAreaSchemaError();
      }
      validateSelectedPaginationPage(pagePagination, offset);
      mergePaginatedSafeAreaRecords(records, page.records);
      if (records.size > MAX_SAFE_AREA_RECORDS) {
        throw safeAreaLimitError();
      }
    }

    if (records.size === 0) {
      throw paginatedSafeAreaSchemaError();
    }

    return {
      area,
      bodyBytes,
      records: [...records.values()],
      rowCount: records.size
    };
  }

  private async fetchSingleSafeAreaPage(
    area: MatoolSafeArea
  ): Promise<MatoolSafeAreaResult> {
    const page = await this.fetchSafeAreaPage(area);
    return {
      area,
      bodyBytes: page.bodyBytes,
      records: page.records,
      rowCount: page.records.length
    };
  }

  private async fetchSafeAreaPage(
    area: MatoolSafeArea,
    offset?: number
  ): Promise<SafeAreaPageResult> {
    const query = new URLSearchParams({ show: area });
    if (offset !== undefined) {
      if (area === "schueler") {
        query.set("todo", "");
      }
      query.set("offset", String(offset));
    }

    const path = `/index.php?${query.toString()}`;
    const init = {
      headers: { Accept: "text/html,application/xhtml+xml" },
      method: "GET"
    } satisfies RequestInit;
    const response =
      area === "interessenten"
        ? await this.requestInteressentenWithStatusRetry(path, init)
        : await this.request(path, init);
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
    const page = await extractSafeAreaPage(
      body,
      contentType,
      area
    );
    return {
      bodyBytes: body.byteLength,
      ...page
    };
  }

  /**
   * Ermittelt die stabilen IDs der Interessentenliste und liest fuer die
   * begrenzte Teilmenge die Detaildaten ueber MATOOLs read-only-Endpunkt.
   * Es wird weder ein Datensatz geoeffnet noch ein Formular gespeichert.
   */
  async extractInteressentenDetails(
    credentials: MatoolCredentials,
    maxRecords: number,
    sourceIds?: readonly string[]
  ): Promise<MatoolSafeAreaResult> {
    requireCredentials(credentials);
    const requestedIds = sourceIds
      ? selectRequestedInteressentIds(sourceIds)
      : undefined;
    const limit = Math.min(
      MAX_INTERESSENTEN_DETAIL_RECORDS,
      Math.max(0, Math.trunc(maxRecords))
    );
    await this.login(credentials);

    let bodyBytes = 0;
    let selectedHandles: string[];
    if (requestedIds) {
      selectedHandles = requestedIds.slice(0, limit);
    } else {
      const listBody = await this.fetchInteressentenPage();
      bodyBytes = listBody.byteLength;
      selectedHandles = (
        await extractInteressentenDetailHandles(listBody)
      ).slice(0, limit);
    }
    const records: MatoolSafeAreaRecord[] = [];

    for (const handle of selectedHandles) {
      const detail = await this.fetchInteressentDetail(handle);
      bodyBytes += detail.bodyBytes;
      records.push(detail.record);
    }

    return {
      area: "interessenten_details",
      bodyBytes,
      records,
      rowCount: records.length
    };
  }

  /** Liest genau einen Interessenten anhand seiner stabilen MATOOL-ID. */
  async extractInteressentDetail(
    credentials: MatoolCredentials,
    sourceId: string
  ): Promise<MatoolSafeAreaRecord> {
    requireCredentials(credentials);
    requireInteressentId(sourceId);
    await this.login(credentials);
    return (await this.fetchInteressentDetail(sourceId)).record;
  }

  private async fetchInteressentenPage(): Promise<Uint8Array> {
    const response = await this.requestInteressentenWithStatusRetry(
      "/index.php?show=interessenten",
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
    return readBoundedBody(response);
  }

  private async fetchInteressentDetail(
    interessentId: string
  ): Promise<{ bodyBytes: number; record: MatoolSafeAreaRecord }> {
    requireInteressentId(interessentId);
    const response = await this.requestInteressentenWithStatusRetry(
      "/json/statistik_daten.php",
      {
        body: new URLSearchParams({ id: interessentId }),
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        method: "POST"
      }
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "matool_interessent_detail_failed",
        502,
        "Die MATOOL-Interessentendetails konnten nicht gelesen werden."
      );
    }
    const body = await readBoundedBody(response);
    return {
      bodyBytes: body.byteLength,
      record: parseInteressentDetailResponse(body, interessentId)
    };
  }

  /**
   * Liest die Stammdaten einzelner Mitglieder ueber den JSON-Endpunkt der
   * Schuelerverwaltung. Das ist derselbe Weg, den MATOOL fuer Klassen
   * verwendet, und deutlich sparsamer als ein vollstaendiger Seitenabruf.
   *
   * Antwortet MATOOL nicht wie erwartet, schlaegt der Abruf fehl, statt
   * einen Datensatz zu raten.
   */
  async extractSchuelerDetails(
    credentials: MatoolCredentials,
    sourceIds: readonly string[]
  ): Promise<MatoolSafeAreaResult> {
    requireCredentials(credentials);
    await this.login(credentials);

    const records: MatoolSafeAreaRecord[] = [];
    const seen = new Set<string>();
    let bodyBytes = 0;

    for (const sourceId of sourceIds) {
      if (!/^\d{1,32}$/u.test(sourceId) || seen.has(sourceId)) {
        continue;
      }
      seen.add(sourceId);

      const response = await this.request("/json/schueler_daten.php", {
        // Aus der HAR-Aufnahme belegt: MATOOL sendet todo leer.
        body: new URLSearchParams({ id: sourceId, todo: "" }),
        headers: {
          Accept: "application/json,text/javascript,*/*;q=0.01",
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        method: "POST"
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw schuelerSchemaError();
      }
      const responseBody = await readBoundedBody(response);
      bodyBytes += responseBody.byteLength;
      records.push({
        payload: parseSchuelerDetailResponse(responseBody, sourceId),
        sourceId
      });
    }

    return {
      area: "schueler",
      bodyBytes,
      records,
      rowCount: records.length
    };
  }

  async extractKlassen(
    credentials: MatoolCredentials,
    batch: MatoolKlassenBatchOptions = {}
  ): Promise<MatoolSafeAreaResult> {
    requireCredentials(credentials);
    validateKlassenBatchOptions(batch);
    await this.login(credentials);

    const listResponse = await this.request("/index.php?show=klassen", {
      headers: { Accept: "text/html,application/xhtml+xml" },
      method: "GET"
    });
    if (!listResponse.ok) {
      await listResponse.body?.cancel();
      throw new AppError(
        "matool_unexpected_status",
        502,
        "MATOOL hat für die Klassenansicht einen unerwarteten Status geliefert."
      );
    }
    const listContentType = listResponse.headers.get("Content-Type") ?? "";
    if (!listContentType.toLowerCase().includes("text/html")) {
      await listResponse.body?.cancel();
      throw new AppError(
        "matool_unexpected_content_type",
        502,
        "MATOOL hat für die Klassenansicht kein HTML geliefert."
      );
    }

    const listBody = await readBoundedBody(listResponse);
    const handles = selectKlassenHandleBatch(
      await extractKlassenHandles(listBody, listContentType),
      batch
    );
    const records: MatoolSafeAreaRecord[] = [];
    const sourceIds = new Set<string>();
    let bodyBytes = listBody.byteLength;

    for (const handle of handles) {
      const response = await this.request(
        "/json/klassen_daten.php?todo=daten",
        {
          body: new URLSearchParams({ id: handle }),
          headers: {
            Accept: "application/json,text/javascript,*/*;q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
          },
          method: "POST"
        }
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw klassenSchemaError();
      }
      const responseBody = await readBoundedBody(response);
      bodyBytes += responseBody.byteLength;
      const record = parseKlassenResponse(responseBody);
      if (sourceIds.has(record.sourceId)) {
        throw klassenSchemaError();
      }
      sourceIds.add(record.sourceId);
      records.push(record);
    }

    return {
      area: "klassen",
      bodyBytes,
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

  /**
   * Fuehrt eine MATOOL-Anfrage mit Mindestabstand aus und wiederholt sie
   * einmal nach einer laengeren Pause, wenn die Verbindung abbricht.
   * MATOOL nimmt bei schnellen Anfragefolgen zeitweise keine Verbindungen
   * mehr an; ein einzelner Bereich soll daran nicht scheitern.
   */
  private async fetchWithPacing(
    url: URL,
    init: RequestInit
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const minimumWait =
        attempt === 0
          ? this.#minRequestIntervalMs -
            (Date.now() - this.#lastRequestFinishedAt)
          : Math.max(1_500, this.#minRequestIntervalMs * 4);
      if (minimumWait > 0) {
        await new Promise((resolve) => setTimeout(resolve, minimumWait));
      }

      if (this.#requestCount >= this.#maxRequestCount) {
        console.error(
          JSON.stringify({
            event: "matool_subrequest_limit_reached",
            requestCount: this.#requestCount
          })
        );
        throw matoolSubrequestLimitError();
      }

      try {
        this.#requestCount += 1;
        // Ein Timeout-Signal ist nach dem ersten Timeout dauerhaft
        // abgebrochen. Deshalb braucht jeder Wiederholungsversuch ein
        // frisches Signal. Ein explizit uebergebenes Signal bleibt dagegen
        // unter der Kontrolle des Aufrufers.
        const response = await this.#fetch(url, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(15_000)
        });
        this.#lastRequestFinishedAt = Date.now();
        return response;
      } catch (error) {
        this.#lastRequestFinishedAt = Date.now();
        // Das Cloudflare-Subrequest-Limit ist innerhalb derselben Invocation
        // nicht durch einen Retry behebbar. Es wird deshalb separat und ohne
        // Ausgabe der Runtime-Fehlermeldung klassifiziert.
        if (error instanceof Error && /subrequest/iu.test(error.message)) {
          console.error(
            JSON.stringify({
              event: "matool_subrequest_limit_reached",
              requestCount: this.#requestCount
            })
          );
          throw matoolSubrequestLimitError();
        }
        const category =
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : error instanceof TypeError
              ? "network"
              : "other";
        console.error(
          JSON.stringify({
            attempt: attempt + 1,
            category,
            event: "matool_fetch_failed",
            host: url.hostname,
            method: init.method ?? "GET"
          })
        );
        if (attempt === 1) {
          throw new AppError(
            "matool_network_error",
            502,
            "MATOOL konnte für die read-only-Probe nicht erreicht werden."
          );
        }
      }
    }

    throw new AppError(
      "matool_network_error",
      502,
      "MATOOL konnte für die read-only-Probe nicht erreicht werden."
    );
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

      const response = await this.fetchWithPacing(url, {
        ...init,
        body,
        headers,
        method,
        redirect: "manual"
      });
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

  private async requestInteressentenWithStatusRetry(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    for (
      let attempt = 1;
      attempt <= MAX_INTERESSENTEN_STATUS_ATTEMPTS;
      attempt += 1
    ) {
      const response = await this.request(path, init);
      if (
        !isRetryableInteressentenStatus(response.status) ||
        attempt === MAX_INTERESSENTEN_STATUS_ATTEMPTS
      ) {
        return response;
      }

      const retryAfterMs = parseInteressentenRetryAfter(
        response.headers.get("Retry-After")
      );
      await response.body?.cancel();
      if (retryAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      }
    }

    throw new Error("unreachable Interessenten retry state");
  }
}

function isRetryableInteressentenStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function parseInteressentenRetryAfter(value: string | null): number {
  const retryAfter = value?.trim() ?? "";
  if (/^\d+$/u.test(retryAfter)) {
    const seconds = Number(retryAfter);
    return Math.min(
      MAX_INTERESSENTEN_RETRY_AFTER_MS,
      Number.isFinite(seconds)
        ? seconds * 1_000
        : MAX_INTERESSENTEN_RETRY_AFTER_MS
    );
  }
  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return 0;
  }
  return Math.min(
    MAX_INTERESSENTEN_RETRY_AFTER_MS,
    Math.max(0, retryAt - Date.now())
  );
}

function normalizeMaxRequestCount(value: number | undefined): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxRequestCount must be a positive safe integer");
  }
  return value;
}

function matoolSubrequestLimitError(): AppError {
  return new AppError(
    "matool_subrequest_limit",
    503,
    "Das Anfragekontingent dieses MATOOL-Laufs ist aufgebraucht."
  );
}

function validateKlassenBatchOptions(
  batch: MatoolKlassenBatchOptions
): void {
  if (
    batch.maxRecords !== undefined &&
    (!Number.isSafeInteger(batch.maxRecords) ||
      batch.maxRecords < 1 ||
      batch.maxRecords > MAX_KLASSEN_RECORDS)
  ) {
    throw invalidKlassenBatchOptions();
  }
  if (
    batch.offset !== undefined &&
    (!Number.isSafeInteger(batch.offset) || batch.offset < 0)
  ) {
    throw invalidKlassenBatchOptions();
  }
}

function selectKlassenHandleBatch(
  handles: readonly string[],
  batch: MatoolKlassenBatchOptions
): string[] {
  const batchSize = Math.min(
    batch.maxRecords ?? handles.length,
    handles.length
  );
  const start = handles.length === 0 ? 0 : (batch.offset ?? 0) % handles.length;
  const selected: string[] = [];
  for (let index = 0; index < batchSize; index += 1) {
    const handle = handles[(start + index) % handles.length];
    if (handle === undefined) {
      throw klassenSchemaError();
    }
    selected.push(handle);
  }
  return selected;
}

function invalidKlassenBatchOptions(): AppError {
  return new AppError(
    "matool_invalid_klassen_batch",
    400,
    "Das angeforderte MATOOL-Klassenpaket ist ungueltig."
  );
}

async function extractKlassenHandles(
  body: Uint8Array,
  contentType: string
): Promise<string[]> {
  const handles: string[] = [];
  const seen = new Set<string>();
  let mailFieldDetected = false;
  let paginationDetected = false;
  let passwordFieldDetected = false;

  const transformed = new HTMLRewriter()
    .on("div[onclick]", {
      element(element) {
        const match =
          /^\s*formular_fuellen\(\s*(['"])(\d{1,64})\1\s*\)\s*;?\s*$/u.exec(
            element.getAttribute("onclick") ?? ""
          );
        const handle = match?.[2];
        if (!handle) {
          return;
        }
        if (seen.has(handle)) {
          return;
        }
        seen.add(handle);
        handles.push(handle);
      }
    })
    .on("input", {
      element(element) {
        const name = element.getAttribute("name")?.trim().toLowerCase();
        mailFieldDetected ||= name === "mail";
        passwordFieldDetected ||= name === "pass";
      }
    })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href") ?? "";
        let url: URL;
        try {
          url = new URL(href.replace(/&amp;/giu, "&"), "https://core.matool.de");
        } catch {
          return;
        }
        paginationDetected ||= [
          "page",
          "seite",
          "offset",
          "limit",
          "start",
          "length"
        ].some((key) => url.searchParams.has(key));
      }
    });

  await drainBody(
    transformed.transform(
      new Response(body, { headers: { "Content-Type": contentType } })
    ).body
  );

  if (mailFieldDetected && passwordFieldDetected) {
    throw new AppError(
      "matool_authentication_unverified",
      502,
      "Die angemeldete MATOOL-Klassenansicht konnte nicht bestätigt werden."
    );
  }
  if (
    handles.length === 0 ||
    handles.length > MAX_KLASSEN_RECORDS ||
    paginationDetected
  ) {
    throw klassenSchemaError();
  }
  return handles;
}

function parseKlassenResponse(body: Uint8Array): MatoolSafeAreaRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw klassenSchemaError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw klassenSchemaError();
  }
  const candidate = parsed[0];
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw klassenSchemaError();
  }

  const source = candidate as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== KLASSEN_RESPONSE_FIELDS.size ||
    keys.some((key) => !KLASSEN_RESPONSE_FIELDS.has(key))
  ) {
    throw klassenSchemaError();
  }
  if (
    !Array.isArray(source.schuelerliste) ||
    KLASSEN_EXCLUDED_FIELDS.filter((field) => field !== "schuelerliste").some(
      (field) => typeof source[field] !== "string"
    )
  ) {
    throw klassenSchemaError();
  }

  const payload: Record<string, string | null> = {};
  for (const field of MATOOL_KLASSEN_PAYLOAD_FIELDS) {
    const value = source[field];
    if (value !== null && typeof value !== "string") {
      throw klassenSchemaError();
    }
    payload[field] = value;
  }
  const sourceId = payload.id;
  if (typeof sourceId !== "string" || !/^\d{1,64}$/u.test(sourceId)) {
    throw klassenSchemaError();
  }
  return { payload, sourceId };
}

function schuelerSchemaError(): AppError {
  return new AppError(
    "matool_schueler_schema_mismatch",
    502,
    "MATOOL hat die Mitgliederdaten nicht im erwarteten Format geliefert."
  );
}

/**
 * Wertet die JSON-Antwort der Schuelerverwaltung aus. Uebernommen werden
 * ausschliesslich freigegebene Felder mit einfachen Werten; Kontodaten und
 * verschachtelte Strukturen wie Dokument- oder Historienlisten bleiben
 * aussen vor.
 */
function parseSchuelerDetailResponse(
  body: Uint8Array,
  expectedSourceId: string
): Record<string, string | number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw schuelerSchemaError();
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw schuelerSchemaError();
  }

  const source = record as Record<string, unknown>;
  const payload: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(source)) {
    const field = key.trim();
    // Alle einfachen Werte uebernehmen, statt Feldnamen zu raten.
    // Verschachtelte Strukturen wie Dokument-, Historien- oder
    // Check-in-Listen bleiben dadurch automatisch aussen vor.
    if (
      !SAFE_SCHUELER_FIELD_NAME.test(field) ||
      Object.keys(payload).length >= MAX_SCHUELER_DETAIL_FIELDS ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      payload[field] = value;
      continue;
    }
    if (typeof value === "string" || typeof value === "boolean") {
      payload[field] = String(value)
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, MAX_SAFE_AREA_CELL_LENGTH);
    }
  }

  // Ohne bestaetigte Identitaet wird nichts uebernommen: sonst koennten
  // Werte dem falschen Mitglied zugeordnet werden.
  if (
    Object.keys(payload).length === 0 ||
    (payload["id"] !== undefined &&
      String(payload["id"]) !== expectedSourceId)
  ) {
    throw schuelerSchemaError();
  }
  payload["id"] = expectedSourceId;
  return payload;
}

function klassenSchemaError(): AppError {
  return new AppError(
    "matool_klassen_schema_mismatch",
    502,
    "Die MATOOL-Klassendaten entsprechen nicht dem bestätigten Schema."
  );
}

interface SafeAreaRowCapture {
  cells: string[];
  header: boolean;
  hrefIds: Array<{ id: string; key: string }>;
  linkCount: number;
  onclickIds: string[];
  parentRow: SafeAreaRowCapture | undefined;
  stableListIds: string[];
  tableIndex: number;
  tdCount: number;
  thCount: number;
}

interface SafeAreaPaginationMarker {
  href?: string;
  text: string;
}

interface SafeAreaPaginationCapture {
  detected: boolean;
  invalidElement: boolean;
  links: string[];
  selected: SafeAreaPaginationMarker[];
}

interface ParsedSafeAreaPage {
  pagination: SafeAreaPaginationCapture;
  records: MatoolSafeAreaRecord[];
}

interface SafeAreaPageResult extends ParsedSafeAreaPage {
  bodyBytes: number;
}

/**
 * Ordnet Kopfzeilen ihrer Spaltenzahl zu und bildet daraus stabile
 * Feldschluessel. Mehrdeutige Spaltenzahlen bleiben unbenannt, damit kein
 * falscher Name entsteht: dann greift wieder die Nummerierung.
 */
function collectSafeAreaHeaderNames(
  rows: readonly SafeAreaRowCapture[]
): Map<number, string[]> {
  const candidates = new Map<number, string[][]>();
  for (const row of rows) {
    const isHeaderRow =
      row.header || (row.thCount > 0 && row.tdCount === 0);
    if (!isHeaderRow) {
      continue;
    }
    const labels = row.cells.map(normalizeSafeAreaCell);
    if (
      labels.length === 0 ||
      labels.length > MAX_SAFE_AREA_CELLS ||
      labels.some((label) => label.length === 0)
    ) {
      continue;
    }
    const names = toSafeAreaFieldNames(labels);
    if (!names) {
      continue;
    }
    const bucket = candidates.get(labels.length) ?? [];
    bucket.push(names);
    candidates.set(labels.length, bucket);
  }

  const resolved = new Map<number, string[]>();
  for (const [columnCount, variants] of candidates) {
    const first = variants[0];
    if (!first) {
      continue;
    }
    const consistent = variants.every(
      (variant) => variant.join("\u0000") === first.join("\u0000")
    );
    if (consistent) {
      resolved.set(columnCount, first);
    }
  }
  return resolved;
}

/**
 * Wandelt Spaltenueberschriften in Schluessel um, die sowohl der
 * Snapshot-Speicher als auch die Dashboard-Anzeige akzeptieren.
 * Gibt `undefined` zurueck, sobald ein Name unbrauchbar oder doppelt ist.
 */
function toSafeAreaFieldNames(
  labels: readonly string[]
): string[] | undefined {
  const reserved = new Set(["columnCount", "tableIndex"]);
  const names: string[] = [];
  const used = new Set<string>();
  for (const label of labels) {
    const name = toSafeAreaFieldName(label);
    if (!name || reserved.has(name) || used.has(name)) {
      return undefined;
    }
    used.add(name);
    names.push(name);
  }
  return names;
}

function toSafeAreaFieldName(label: string): string | undefined {
  const slug = label
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (slug.length === 0 || slug.length > 48) {
    return undefined;
  }
  const name = /^[a-z]/u.test(slug) ? slug : `feld_${slug}`;
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ? name : undefined;
}

/**
 * Schranken fuer Mitglieder-Stammdaten. Uebernommen wird jedes einfache
 * Feld, das MATOOL liefert - einschliesslich der Zahlungs- und Bankdaten,
 * die ausdruecklich angefordert wurden. Verschachtelte Strukturen wie
 * Dokument-, Historien- oder Check-in-Listen bleiben aussen vor.
 *
 * Hinweis: Das Dashboard ist oeffentlich erreichbar und zeigt in der
 * Testphase Klartext. Vor echten Mitgliederdaten gehoert
 * PUBLIC_DASHBOARD_PLAINTEXT auf "false".
 */
const SAFE_SCHUELER_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const MAX_SCHUELER_DETAIL_FIELDS = 80;

/**
 * Vollstaendige, HAR-bestaetigte Allowlist fuer die Interessentenmaske.
 * Neue oder unbekannte Antwortfelder werden nicht in Snapshots uebernommen.
 */
export const MATOOL_INTERESSENT_DETAIL_FIELDS = [
  "id",
  "datum",
  "anrede",
  "vorname",
  "name",
  "strasse",
  "plz",
  "ort",
  "email",
  "handy",
  "telefon",
  "quelle",
  "kontakt",
  "kontaktart",
  "schule",
  "leistung",
  "einfuehrung",
  "einfuehrung_zeit",
  "einfuehrung_klasse",
  "einfuehrung_klasse_name",
  "einfuehrung_benutzer",
  "einfuehrung_anwesend",
  "ergebnis_einfuehrung",
  "probetraining",
  "probetraining_zeit",
  "probetraining_klasse",
  "probetraining_klasse_name",
  "probetraining_benutzer",
  "probetraining_anwesend",
  "ergebnis_probetraining",
  "status",
  "text",
  "werbung",
  "werbung_bezeichnung"
] as const;
const MATOOL_INTERESSENT_DETAIL_FIELD_SET = new Set<string>(
  MATOOL_INTERESSENT_DETAIL_FIELDS
);

/** Liest die internen MATOOL-Kennungen der Listenzeilen. */
async function extractInteressentenDetailHandles(
  body: Uint8Array
): Promise<string[]> {
  const handles: string[] = [];
  const seen = new Set<string>();
  const rewriter = new HTMLRewriter().on("[onclick]", {
    element(element) {
      if (handles.length >= MAX_INTERESSENTEN_DETAIL_HANDLES) {
        return;
      }
      const match = /\bformular_fuellen\s*\(\s*['"]?(\d{1,32})/iu.exec(
        element.getAttribute("onclick") ?? ""
      );
      const id = match?.[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        handles.push(id);
      }
    }
  });
  await drainBody(
    rewriter.transform(
      new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    ).body
  );
  return handles;
}

function requireInteressentId(sourceId: string): void {
  if (!/^\d{1,32}$/u.test(sourceId)) {
    throw new AppError(
      "matool_invalid_interessent_id",
      400,
      "Die MATOOL-Interessentenkennung ist ungueltig."
    );
  }
}

function selectRequestedInteressentIds(
  sourceIds: readonly string[]
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const sourceId of sourceIds) {
    requireInteressentId(sourceId);
    if (seen.has(sourceId)) {
      throw new AppError(
        "matool_duplicate_interessent_id",
        400,
        "Eine MATOOL-Interessentenkennung wurde mehrfach angefordert."
      );
    }
    seen.add(sourceId);
    selected.push(sourceId);
  }
  return selected;
}

/**
 * Prueft MATOOLs JSON-Detailantwort und kopiert ausschliesslich Felder der
 * bestaetigten Allowlist. Die ID muss mit der angefragten Listen-ID
 * uebereinstimmen, bevor irgendein Payload zurueckgegeben wird.
 */
function parseInteressentDetailResponse(
  body: Uint8Array,
  expectedSourceId: string
): MatoolSafeAreaRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw interessentDetailSchemaError();
  }
  const candidates = collectInteressentDetailCandidates(parsed);
  if (candidates.length !== 1) {
    throw interessentDetailSchemaError();
  }
  const candidate = candidates[0];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw interessentDetailSchemaError();
  }

  const source = candidate as Record<string, unknown>;
  const keys = Object.keys(source);
  if (
    keys.length !== MATOOL_INTERESSENT_DETAIL_FIELDS.length ||
    keys.some((key) => !MATOOL_INTERESSENT_DETAIL_FIELD_SET.has(key))
  ) {
    throw interessentDetailSchemaError();
  }
  const id = normalizeInteressentDetailValue(source["id"], false);
  if (!id || id !== expectedSourceId || !/^\d{1,32}$/u.test(id)) {
    throw interessentDetailSchemaError();
  }

  const payload: Record<string, string | null> = {};
  for (const field of MATOOL_INTERESSENT_DETAIL_FIELDS) {
    if (!(field in source)) {
      throw interessentDetailSchemaError();
    }
    const value = normalizeInteressentDetailValue(
      source[field],
      field === "text"
    );
    if (value === undefined) {
      throw interessentDetailSchemaError();
    }
    payload[field] = value;
  }
  payload.id = id;
  return { payload, sourceId: id };
}

function collectInteressentDetailCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  const record = parsed as Record<string, unknown>;
  return Object.hasOwn(record, "id") ? [record] : Object.values(record);
}

function normalizeInteressentDetailValue(
  value: unknown,
  preserveWhitespace: boolean
): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  const normalized = preserveWhitespace
    ? String(value).trim()
    : String(value).replace(/\s+/gu, " ").trim();
  return normalized.length <= MAX_INTERESSENT_DETAIL_VALUE_LENGTH
    ? normalized
    : undefined;
}

function interessentDetailSchemaError(): AppError {
  return new AppError(
    "matool_interessent_detail_schema_mismatch",
    502,
    "Die MATOOL-Interessentendetails entsprechen nicht dem bestaetigten Schema."
  );
}

async function extractSafeAreaPage(
  body: Uint8Array,
  contentType: string,
  area: MatoolSafeArea
): Promise<ParsedSafeAreaPage> {
  const strictListArea = isPaginatedSafeArea(area);
  const rows: SafeAreaRowCapture[] = [];
  const pagination: SafeAreaPaginationCapture = {
    detected: false,
    invalidElement: false,
    links: [],
    selected: []
  };
  const selectedPaginationStack: SafeAreaPaginationMarker[] = [];
  const tableStack: number[] = [];
  const rowStack: SafeAreaRowCapture[] = [];
  type CellCapture = {
    ignoredDepth: number;
    row: SafeAreaRowCapture;
    text: string;
  };
  const cellStack: CellCapture[] = [];
  let tableCount = 0;
  let activeRow: SafeAreaRowCapture | undefined;
  let activeCell: CellCapture | undefined;
  let mailFieldDetected = false;
  let passwordFieldDetected = false;

  const startCell = (kind: "td" | "th"): CellCapture | undefined => {
    if (!activeRow || activeRow.cells.length >= MAX_SAFE_AREA_CELLS) {
      if (!strictListArea) {
        activeCell = undefined;
      }
      return undefined;
    }
    if (kind === "td") {
      activeRow.tdCount += 1;
    } else {
      activeRow.thCount += 1;
    }
    const capture = { ignoredDepth: 0, row: activeRow, text: "" };
    activeCell = capture;
    if (strictListArea) {
      cellStack.push(capture);
    }
    return capture;
  };
  const endCell = (capture: CellCapture | undefined): void => {
    if (!capture) {
      return;
    }
    if (!strictListArea) {
      if (activeCell === capture) {
        capture.row.cells.push(capture.text);
        activeCell = undefined;
      }
      return;
    }
    if (cellStack.at(-1) !== capture) {
      throw paginatedSafeAreaSchemaError();
    }
    cellStack.pop();
    capture.row.cells.push(capture.text);
    const parent = cellStack.at(-1);
    if (parent && capture.text.trim().length > 0) {
      parent.text = appendBounded(
        parent.text,
        `${parent.text.trim().length > 0 ? " " : ""}${capture.text}`,
        MAX_SAFE_AREA_CELL_LENGTH
      );
    }
    activeCell = parent;
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
          header: false,
          hrefIds: [],
          linkCount: 0,
          onclickIds: [],
          parentRow: strictListArea ? rowStack.at(-1) : undefined,
          stableListIds: [],
          tableIndex: tableStack.at(-1) ?? -1,
          tdCount: 0,
          thCount: 0
        };
        activeRow = row;
        if (strictListArea) {
          rowStack.push(row);
        }
        rows.push(row);
        element.onEndTag(() => {
          if (!strictListArea) {
            if (activeRow === row) {
              activeRow = undefined;
            }
            return;
          }
          if (rowStack.at(-1) !== row) {
            throw paginatedSafeAreaSchemaError();
          }
          rowStack.pop();
          activeRow = rowStack.at(-1);
        });
      }
    })
    // MATOOL kennzeichnet Kopfzeilen ueber diese Klasse und verwendet darin
    // gewoehnliche td-Zellen statt th.
    .on("tr.master_tab_tr_head", {
      element() {
        if (activeRow) {
          activeRow.header = true;
        }
      }
    })
    .on("table td", {
      element(element) {
        const capture = startCell("td");
        element.onEndTag(() => endCell(capture));
      },
      text(text) {
        appendText(text.text);
      }
    })
    .on("table th", {
      element(element) {
        const capture = startCell("th");
        element.onEndTag(() => endCell(capture));
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
        const onclick = element.getAttribute("onclick") ?? "";
        const stableListId = extractStableListId(onclick, area);
        if (stableListId) {
          activeRow.stableListIds.push(stableListId);
        }
        const match =
          /^\s*(?:formular_fuellen|open\w*|show\w*|load\w*|edit\w*|.*(?:daten|detail)\w*)\s*\(\s*['"]?(\d{1,64})/iu.exec(
            onclick
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
    .on(".pagination", {
      element(element) {
        pagination.detected = true;
        const href = element.getAttribute("href");
        if (element.tagName.toLowerCase() !== "a" || !href) {
          pagination.invalidElement = true;
          return;
        }
        if (pagination.links.length >= MAX_SAFE_AREA_PAGES) {
          pagination.invalidElement = true;
          return;
        }
        pagination.links.push(href);
      }
    })
    .on(".pagination_selected", {
      element(element) {
        pagination.detected = true;
        const href = element.getAttribute("href") ?? undefined;
        const marker: SafeAreaPaginationMarker = {
          ...(href ? { href } : {}),
          text: ""
        };
        if (pagination.selected.length >= MAX_SAFE_AREA_PAGES) {
          pagination.invalidElement = true;
          return;
        }
        pagination.selected.push(marker);
        selectedPaginationStack.push(marker);
        if (href) {
          pagination.links.push(href);
        }
        element.onEndTag(() => {
          if (selectedPaginationStack.at(-1) === marker) {
            selectedPaginationStack.pop();
          }
        });
      },
      text(text) {
        const marker = selectedPaginationStack.at(-1);
        if (marker) {
          marker.text = appendBounded(marker.text, text.text, 32);
        }
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

  // Spaltennamen aus der Kopfzeile ableiten, statt die Zellen nur
  // durchzunummerieren. MATOOL fuehrt die Kopfzeile teils in einer eigenen
  // Tabelle, deshalb wird sie ueber die Spaltenzahl zugeordnet.
  const headerNamesByColumnCount = collectSafeAreaHeaderNames(rows);

  const prepared: Array<{
    explicitId?: string;
    payload: Record<string, string | number>;
  }> = [];
  if (area === "interessenten") {
    prepared.push(
      ...prepareInteressentenSafeAreaRows(
        rows,
        headerNamesByColumnCount
      )
    );
  } else if (area === "schueler") {
    prepared.push(
      ...prepareSchuelerSafeAreaRows(
        rows,
        headerNamesByColumnCount
      )
    );
  }
  const seen = new Set<string>();
  for (const row of area === "interessenten" || area === "schueler" ? [] : rows) {
    // Kopfzeilen sind keine Datensaetze.
    if (row.header || row.cells.length === 0 || row.tdCount === 0) {
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
    const headerNames = headerNamesByColumnCount.get(cells.length);
    cells.forEach((cell, index) => {
      const fallback = `c${index.toString().padStart(2, "0")}`;
      payload[headerNames?.[index] ?? fallback] = cell;
    });
    const explicitId = strictListArea
      ? row.stableListIds.length === 1
        ? row.stableListIds[0]
        : undefined
      : selectSafeAreaSourceId(row, area);
    if (strictListArea && !explicitId) {
      continue;
    }
    const rowKey = explicitId
      ? `id:${explicitId}`
      : `payload:${canonicalJson(payload)}`;
    if (!strictListArea && seen.has(rowKey)) {
      continue;
    }
    if (!strictListArea) {
      seen.add(rowKey);
    }
    if (prepared.length >= MAX_SAFE_AREA_RECORDS) {
      throw new AppError(
        "matool_safe_area_limit_exceeded",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Datensatzlimit."
      );
    }
    prepared.push({ ...(explicitId ? { explicitId } : {}), payload });
  }

  const records = await Promise.all(
    prepared.map(async ({ explicitId, payload }) => ({
      payload,
      sourceId:
        explicitId ?? (await sha256Hex(canonicalJson(payload)))
    }))
  );
  return { pagination, records };
}

/**
 * MATOOL trennt jede sichtbare Interessentenzeile von ihrer technischen
 * ID-Zeile. Die ID-Zeile folgt direkt danach und enthaelt zusaetzliche,
 * verschachtelte Detailtabellen, die nicht Teil des Listen-Payloads sind.
 */
function prepareInteressentenSafeAreaRows(
  rows: readonly SafeAreaRowCapture[],
  headerNamesByColumnCount: ReadonlyMap<number, string[]>
): Array<{
  explicitId: string;
  payload: Record<string, string | number>;
}> {
  const matchingHeaders = rows.filter(
    (row) =>
      row.header &&
      row.tdCount === INTERESSENTEN_SAFE_AREA_FIELDS.length &&
      row.thCount === 0 &&
      sameStrings(
        toSafeAreaFieldNames(row.cells.map(normalizeSafeAreaCell)) ?? [],
        INTERESSENTEN_SAFE_AREA_FIELDS
      )
  );
  const headerNames = headerNamesByColumnCount.get(
    INTERESSENTEN_SAFE_AREA_FIELDS.length
  );
  if (
    matchingHeaders.length !== 1 ||
    !headerNames ||
    !sameStrings(headerNames, INTERESSENTEN_SAFE_AREA_FIELDS)
  ) {
    throw paginatedSafeAreaSchemaError();
  }

  const identifierRowIndexes: number[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.stableListIds.length === 0) {
      continue;
    }
    if (
      row.header ||
      row.stableListIds.length !== 1 ||
      row.tdCount !== 2 ||
      row.thCount !== 0 ||
      row.cells.length !== 2 ||
      isNestedUnderInteressentenIdentifierRow(row)
    ) {
      throw paginatedSafeAreaSchemaError();
    }
    const previous = rows[index - 1];
    if (!previous || !isInteressentenSafeAreaDataRow(previous)) {
      throw paginatedSafeAreaSchemaError();
    }
    identifierRowIndexes.push(index);
  }
  if (identifierRowIndexes.length === 0) {
    throw paginatedSafeAreaSchemaError();
  }

  const records: Array<{
    explicitId: string;
    payload: Record<string, string | number>;
  }> = [];
  const seenSourceIds = new Set<string>();
  let dataRowCount = 0;
  for (const [index, row] of rows.entries()) {
    if (!isInteressentenSafeAreaDataRow(row)) {
      continue;
    }
    dataRowCount += 1;
    const identifierRow = rows[index + 1];
    if (
      !identifierRow ||
      identifierRow.stableListIds.length !== 1 ||
      identifierRow.tdCount !== 2 ||
      identifierRow.thCount !== 0 ||
      identifierRow.cells.length !== 2 ||
      isNestedUnderInteressentenIdentifierRow(identifierRow)
    ) {
      throw paginatedSafeAreaSchemaError();
    }
    const explicitId = identifierRow.stableListIds[0];
    if (!explicitId || seenSourceIds.has(explicitId)) {
      throw paginatedSafeAreaSchemaError();
    }
    seenSourceIds.add(explicitId);

    const cells = row.cells.map(normalizeSafeAreaCell);
    const payload: Record<string, string | number> = {
      columnCount: cells.length,
      tableIndex: row.tableIndex
    };
    cells.forEach((cell, cellIndex) => {
      const field = INTERESSENTEN_SAFE_AREA_FIELDS[cellIndex];
      if (!field) {
        throw paginatedSafeAreaSchemaError();
      }
      payload[field] = cell;
    });
    records.push({ explicitId, payload });
  }

  if (
    dataRowCount !== identifierRowIndexes.length ||
    records.length !== dataRowCount
  ) {
    throw paginatedSafeAreaSchemaError();
  }
  return records;
}

function isInteressentenSafeAreaDataRow(
  row: SafeAreaRowCapture
): boolean {
  return (
    !row.header &&
    row.stableListIds.length === 0 &&
    row.tdCount === INTERESSENTEN_SAFE_AREA_FIELDS.length &&
    row.thCount === 0 &&
    row.cells.length === INTERESSENTEN_SAFE_AREA_FIELDS.length &&
    !isNestedUnderInteressentenIdentifierRow(row)
  );
}

function isNestedUnderInteressentenIdentifierRow(
  row: SafeAreaRowCapture
): boolean {
  let parent = row.parentRow;
  while (parent) {
    if (parent.stableListIds.length > 0) {
      return true;
    }
    parent = parent.parentRow;
  }
  return false;
}

/**
 * MATOOL-Schuelerlisten enthalten pro Person eine Zeile mit stabiler ID.
 * Die folgende Registerzeile und Detail-Zeilen sind strukturelle Elemente,
 * die nicht als separate Datensaetze gespeichert werden.
 */
function prepareSchuelerSafeAreaRows(
  rows: readonly SafeAreaRowCapture[],
  headerNamesByColumnCount: ReadonlyMap<number, string[]>
): Array<{
  explicitId: string;
  payload: Record<string, string | number>;
}> {
  const records: Array<{
    explicitId: string;
    payload: Record<string, string | number>;
  }> = [];
  const seenSourceIds = new Set<string>();

  for (const row of rows) {
    if (row.header || row.stableListIds.length !== 1) {
      continue;
    }
    if (isNestedUnderSchuelerRow(row)) {
      continue;
    }
    const sourceId = row.stableListIds[0];
    // Zeilen ohne stabile Kennung sind keine Datensaetze, sondern Layout
    // oder Zwischenueberschriften. Sie werden uebersprungen; ein ganzer
    // Bereich darf daran nicht scheitern.
    if (!sourceId) {
      continue;
    }
    if (seenSourceIds.has(sourceId)) {
      throw paginatedSafeAreaSchemaError();
    }
    seenSourceIds.add(sourceId);
    const cells = row.cells.map(normalizeSafeAreaCell);
    const payload: Record<string, string | number> = {
      columnCount: cells.length,
      tableIndex: row.tableIndex
    };
    const headerNames = headerNamesByColumnCount.get(cells.length);
    cells.forEach((cell, index) => {
      const fallback = `c${index.toString().padStart(2, "0")}`;
      payload[headerNames?.[index] ?? fallback] = cell;
    });
    records.push({ explicitId: sourceId, payload });
  }

  if (records.length === 0) {
    throw paginatedSafeAreaSchemaError();
  }
  return records;
}

function isNestedUnderSchuelerRow(
  row: SafeAreaRowCapture
): boolean {
  let parent = row.parentRow;
  while (parent) {
    if (parent.stableListIds.length > 0) {
      return true;
    }
    parent = parent.parentRow;
  }
  return false;
}

interface NormalizedSafeAreaPagination {
  detected: boolean;
  offsets: number[];
  selectedOffset?: number;
  selectedPageNumber?: number;
}

function normalizeSafeAreaPagination(
  capture: SafeAreaPaginationCapture,
  area: MatoolPaginatedSafeArea,
  currentOffset: number
): NormalizedSafeAreaPagination {
  if (capture.invalidElement) {
    throw paginatedSafeAreaSchemaError();
  }
  if (!capture.detected) {
    throw paginatedSafeAreaSchemaError();
  }
  if (capture.selected.length === 0) {
    throw paginatedSafeAreaSchemaError();
  }

  const offsets = new Set<number>([currentOffset]);
  for (const href of capture.links) {
    offsets.add(parseSafeAreaPaginationOffset(href, area));
  }

  let selectedOffset: number | undefined;
  let selectedPageNumber: number | undefined;
  for (const marker of capture.selected) {
    const pageText = marker.text.replace(/\s+/gu, "");
    const pageNumber = /^\d+$/u.test(pageText)
      ? Number(pageText)
      : undefined;
    const markerOffset = marker.href
      ? parseSafeAreaPaginationOffset(marker.href, area)
      : undefined;
    if (
      (pageNumber === undefined ||
        !Number.isSafeInteger(pageNumber) ||
        pageNumber < 1) &&
      markerOffset === undefined
    ) {
      throw paginatedSafeAreaSchemaError();
    }
    if (
      pageNumber !== undefined &&
      selectedPageNumber !== undefined &&
      pageNumber !== selectedPageNumber
    ) {
      throw paginatedSafeAreaSchemaError();
    }
    if (
      markerOffset !== undefined &&
      selectedOffset !== undefined &&
      markerOffset !== selectedOffset
    ) {
      throw paginatedSafeAreaSchemaError();
    }
    selectedPageNumber ??= pageNumber;
    selectedOffset ??= markerOffset;
  }

  const normalizedOffsets = [...offsets].sort((left, right) => left - right);
  if (
    normalizedOffsets.length === 0 ||
    normalizedOffsets.length > MAX_SAFE_AREA_PAGES ||
    normalizedOffsets[0] !== 0
  ) {
    throw paginatedSafeAreaSchemaError();
  }
  return {
    detected: true,
    offsets: normalizedOffsets,
    ...(selectedOffset === undefined ? {} : { selectedOffset }),
    ...(selectedPageNumber === undefined ? {} : { selectedPageNumber })
  };
}

function parseSafeAreaPaginationOffset(
  rawHref: string,
  area: MatoolPaginatedSafeArea
): number {
  let url: URL;
  try {
    url = new URL(
      rawHref.replace(/&amp;/giu, "&"),
      "https://core.matool.de/"
    );
  } catch {
    throw paginatedSafeAreaSchemaError();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_MATOOL_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/index.php" ||
    url.hash
  ) {
    throw paginatedSafeAreaSchemaError();
  }

  const entries = [...url.searchParams];
  const allowedKeys =
    area === "schueler"
      ? new Set(["show", "todo", "offset"])
      : new Set(["show", "offset"]);
  if (
    entries.length !== allowedKeys.size ||
    entries.some(([key]) => !allowedKeys.has(key)) ||
    [...allowedKeys].some(
      (key) => entries.filter(([entryKey]) => entryKey === key).length !== 1
    ) ||
    url.searchParams.get("show") !== area ||
    (area === "schueler" && url.searchParams.get("todo") !== "")
  ) {
    throw paginatedSafeAreaSchemaError();
  }

  const rawOffset = url.searchParams.get("offset") ?? "";
  if (!/^(?:0|[1-9]\d*)$/u.test(rawOffset)) {
    throw paginatedSafeAreaSchemaError();
  }
  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw paginatedSafeAreaSchemaError();
  }
  return offset;
}

function validateSelectedPaginationPage(
  pagination: NormalizedSafeAreaPagination,
  expectedOffset: number
): void {
  if (!pagination.detected) {
    if (expectedOffset !== 0) {
      throw paginatedSafeAreaSchemaError();
    }
    return;
  }
  const expectedPageIndex = pagination.offsets.indexOf(expectedOffset);
  if (
    expectedPageIndex < 0 ||
    (pagination.selectedOffset !== undefined &&
      pagination.selectedOffset !== expectedOffset) ||
    (pagination.selectedPageNumber !== undefined &&
      pagination.selectedPageNumber !== expectedPageIndex + 1)
  ) {
    throw paginatedSafeAreaSchemaError();
  }
}

function mergePaginatedSafeAreaRecords(
  target: Map<string, MatoolSafeAreaRecord>,
  records: readonly MatoolSafeAreaRecord[]
): void {
  for (const record of records) {
    const existing = target.get(record.sourceId);
    if (existing) {
      throw paginatedSafeAreaSchemaError();
    }
    if (target.size >= MAX_SAFE_AREA_RECORDS) {
      throw safeAreaLimitError();
    }
    target.set(record.sourceId, record);
  }
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function extractStableListId(
  onclick: string,
  area: MatoolSafeArea
): string | undefined {
  if (!isPaginatedSafeArea(area)) {
    return undefined;
  }
  const match =
    area === "interessenten"
      ? /^\s*formular_fuellen\(\s*(?:(["'])(\d{1,64})\1|(\d{1,64}))\s*\)\s*;?\s*$/u.exec(
          onclick
        )
      : /^\s*formular_fuellen\(\s*(?:(["'])(\d{1,64})\1|(\d{1,64}))\s*,\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*;?\s*$/u.exec(
          onclick
        );
  return match?.[2] ?? match?.[3];
}

function isPaginatedSafeArea(
  area: MatoolSafeArea
): area is MatoolPaginatedSafeArea {
  return PAGINATED_SAFE_AREAS.has(area);
}

function paginatedSafeAreaSchemaError(): AppError {
  return new AppError(
    "matool_paginated_list_schema_mismatch",
    502,
    "Die paginierte MATOOL-Liste entspricht nicht dem bestaetigten Schema."
  );
}

function safeAreaLimitError(): AppError {
  return new AppError(
    "matool_safe_area_limit_exceeded",
    502,
    "Die MATOOL-Antwort ueberschreitet das sichere Datensatzlimit."
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
