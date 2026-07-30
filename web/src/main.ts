interface ProcessPolicy {
  contactChannel: "email" | "sms" | "staff_task" | null;
  contactLeadMinutes: number | null;
  lookbackMinutes: number | null;
}

interface AdminStatus {
  schemaVersion: number;
  environment: string;
  process: {
    mode: "disabled" | "dry_run" | "shadow" | "active";
    name: string;
    policyComplete: boolean;
    policy: ProcessPolicy;
  };
  connections: {
    matool: {
      configured: boolean;
      realRunsEnabled: boolean;
      sourceMappingVerified: boolean;
    };
    zapier: {
      activeSubscriptions: number;
      claimGuardImplemented: boolean;
      configured: boolean;
      outboundEnabled: boolean;
      plan: string;
      targetDedupeVerified: boolean;
      unconfirmedClaims: number;
    };
  };
  lastRun: RunSummary | null;
  matoolSnapshots: {
    areas: Record<string, number>;
    lastRun: {
      area: string;
      errorCode: string | null;
      status: string;
      successCount: number;
    } | null;
  };
  safetyGates: SafetyGate[];
}

interface RunSummary {
  candidateCount: number;
  eventCount: number;
  fetchedCount: number;
  finishedAt: string | null;
  id: string;
  mode: string;
  startedAt: string;
  status: string;
  trigger: string;
}

interface RunsResponse {
  schemaVersion: number;
  runs: RunSummary[];
}

interface SafetyGate {
  key: string;
  state: "open" | "ready" | "requires_confirmation";
}

interface DiscoveryResponse {
  schemaVersion: number;
  discovery: {
    bereich: string;
    bodyBytes: number;
    fields: Array<{
      element: "input" | "select";
      name: string;
      optionCount?: number;
      type?: string;
    }>;
    idPatterns: Array<{
      attribute: "href" | "id" | "onclick";
      occurrences: number;
      pattern: string;
    }>;
    rowCount: number;
    status: number;
    tableCount: number;
    tables: Array<{
      headers: string[];
      index: number;
      rowCount: number;
    }>;
  };
}

const gateLabels: Record<string, [string, string]> = {
  matool_password_rotated: [
    "MATOOL-Passwort rotieren",
    "HAR-Sitzungen ebenfalls beenden"
  ],
  first_trial_source_mapping: [
    "Termin-Felder verifizieren",
    "Stabile Interessenten- und Termin-ID"
  ],
  contact_policy: [
    "Kontaktregel festlegen",
    "Vorlauf, Kanal und Ausschlüsse"
  ],
  zapier_target_dedupe: [
    "Zapier-Deduplizierung nachweisen",
    "Keine doppelte Kundenaktion bei Retry"
  ]
};

let discoveryAvailable = false;

const elements = {
  actionMessage: byId("action-message"),
  discoveryArea: byId<HTMLSelectElement>("discovery-area"),
  discoveryFields: byId<HTMLUListElement>("discovery-fields"),
  discoveryPatterns: byId<HTMLUListElement>("discovery-patterns"),
  discoveryResult: byId("discovery-result"),
  discoverySummary: byId("discovery-summary"),
  discoveryTables: byId<HTMLUListElement>("discovery-tables"),
  discoverStructure: byId<HTMLButtonElement>("discover-structure"),
  environment: byId("environment"),
  gateCount: byId("gate-count"),
  gateList: byId<HTMLOListElement>("gate-list"),
  lastUpdated: byId("last-updated"),
  matoolDetail: byId("matool-detail"),
  matoolStatus: byId("matool-status"),
  modeBadge: byId("mode-badge"),
  overallDot: byId("overall-dot"),
  overallStatus: byId("overall-status"),
  policyChannel: byId("policy-channel"),
  policyLead: byId("policy-lead"),
  policyLookback: byId("policy-lookback"),
  processStatus: byId("process-status"),
  refresh: byId<HTMLButtonElement>("refresh"),
  runDetail: byId("run-detail"),
  runsBody: byId<HTMLTableSectionElement>("runs-body"),
  runStatus: byId("run-status"),
  snapshotBody: byId<HTMLTableSectionElement>("snapshot-body"),
  snapshotTotal: byId("snapshot-total"),
  syncAll: byId<HTMLButtonElement>("sync-all"),
  syncMessage: byId("sync-message"),
  zapierDetail: byId("zapier-detail"),
  zapierStatus: byId("zapier-status")
};

elements.refresh.addEventListener("click", () => {
  void loadDashboard();
});

elements.discoverStructure.addEventListener("click", () => {
  void discoverMatoolStructure();
});

elements.syncAll.addEventListener("click", () => {
  void syncAllMatoolData();
});

void loadDashboard();

async function loadDashboard(): Promise<void> {
  setLoading(true);
  try {
    const [status, runs] = await Promise.all([
      requestJson<AdminStatus>("/api/admin/v1/status"),
      requestJson<RunsResponse>("/api/admin/v1/runs?limit=10")
    ]);
    renderStatus(status);
    renderRuns(runs.runs);
    elements.lastUpdated.textContent = `Aktualisiert ${formatDateTime(
      new Date().toISOString()
    )}`;
  } catch (error) {
    renderUnavailable(
      error instanceof Error
        ? error.message
        : "Der Status konnte nicht geladen werden."
    );
  } finally {
    setLoading(false);
  }
}

function renderStatus(status: AdminStatus): void {
  elements.environment.textContent = environmentLabel(status.environment);
  elements.processStatus.textContent = modeLabel(status.process.mode);
  elements.modeBadge.textContent = modeLabel(status.process.mode);
  elements.modeBadge.dataset.state = status.process.mode;

  elements.matoolStatus.textContent = status.connections.matool.configured
    ? "Secret konfiguriert"
    : "Nicht eingerichtet";
  elements.matoolDetail.textContent =
    status.connections.matool.sourceMappingVerified
      ? "Feldzuordnung bestätigt"
      : "Feldzuordnung noch offen";

  elements.zapierStatus.textContent = status.connections.zapier.configured
    ? "Trigger verbunden"
    : "Trigger ausstehend";
  elements.zapierDetail.textContent =
    status.connections.zapier.unconfirmedClaims > 0
      ? status.connections.zapier.unconfirmedClaims === 1
        ? "1 Vorgang zur Prüfung"
        : `${status.connections.zapier.unconfirmedClaims} Vorgänge zur Prüfung`
      : status.connections.zapier.outboundEnabled
      ? "Ausgabe freigegeben"
      : status.connections.zapier.activeSubscriptions === 1
        ? "Verbindung bereit · Ausgabe gesperrt"
        : "Private App noch nicht verbunden";

  elements.policyLead.textContent = minutesLabel(
    status.process.policy.contactLeadMinutes
  );
  elements.policyLookback.textContent = minutesLabel(
    status.process.policy.lookbackMinutes
  );
  elements.policyChannel.textContent = channelLabel(
    status.process.policy.contactChannel
  );

  if (status.lastRun) {
    elements.runStatus.textContent = runStatusLabel(status.lastRun.status);
    elements.runDetail.textContent = formatDateTime(status.lastRun.startedAt);
  } else {
    elements.runStatus.textContent = "Noch keiner";
    elements.runDetail.textContent = "Keine Echtdaten verarbeitet";
  }

  const openGates = status.safetyGates.filter(
    (gate) => gate.state !== "ready"
  ).length;
  elements.gateCount.textContent =
    openGates === 1 ? "1 offen" : `${openGates} offen`;
  renderGates(status.safetyGates);

  discoveryAvailable =
    status.connections.matool.configured &&
    status.connections.matool.realRunsEnabled;
  elements.discoveryArea.disabled = !discoveryAvailable;
  elements.discoverStructure.disabled = !discoveryAvailable;
  elements.discoverStructure.textContent = discoveryAvailable
    ? "Struktur erkennen"
    : "Strukturprobe noch gesperrt";

  elements.syncAll.disabled = !discoveryAvailable;
  elements.syncAll.textContent = discoveryAvailable
    ? "Alle MATOOL-Daten jetzt abholen"
    : "Datenabruf noch gesperrt";
  renderSnapshots(status.matoolSnapshots);

  if (
    status.process.mode === "active" &&
    status.connections.zapier.outboundEnabled
  ) {
    elements.overallStatus.textContent = "Aktiver Betrieb";
    elements.overallDot.className = "status-dot status-dot-success";
  } else if (openGates === 0) {
    elements.overallStatus.textContent = "Bereit für Shadow-Betrieb";
    elements.overallDot.className = "status-dot status-dot-success";
  } else {
    elements.overallStatus.textContent = "Einrichtung läuft";
    elements.overallDot.className = "status-dot status-dot-warning";
  }
}

function renderSnapshots(
  snapshots: AdminStatus["matoolSnapshots"]
): void {
  const entries = Object.entries(snapshots.areas).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  elements.snapshotTotal.textContent =
    total === 0
      ? "Noch keine Daten"
      : `${formatNumber(total)} Datensätze · ${entries.length} Bereiche`;

  if (entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 2;
    cell.textContent = "Noch keine Daten abgerufen.";
    row.append(cell);
    elements.snapshotBody.replaceChildren(row);
    return;
  }

  elements.snapshotBody.replaceChildren(
    ...entries.map(([area, count]) => {
      const row = document.createElement("tr");
      appendCell(row, areaLabel(area));
      appendCell(row, formatNumber(count));
      return row;
    })
  );
}

function areaLabel(area: string): string {
  return (
    {
      archiv: "Archiv",
      artikel: "Artikel",
      berichte: "Berichte",
      checkin: "Check-ins",
      interessenten: "Interessenten",
      karte: "Karte",
      klassen: "Klassen",
      lager: "Lager",
      newsletter: "Newsletter",
      pruefungen: "Prüfungen",
      schueler: "Schüler",
      telemetrie: "Telemetrie"
    }[area] ?? area
  );
}

async function syncAllMatoolData(): Promise<void> {
  elements.syncAll.disabled = true;
  elements.syncAll.setAttribute("aria-busy", "true");
  elements.syncMessage.textContent =
    "Alle MATOOL-Bereiche werden abgerufen und gespeichert … das dauert einen Moment.";

  try {
    const csrf = await requestJson<{ token: string }>(
      "/api/admin/v1/csrf"
    );
    const result = await requestJson<{
      sync: {
        areas: { area: string; errorCode?: string; status: string }[];
        failed: number;
        storedTotal: number;
        succeeded: number;
      };
    }>("/api/admin/v1/matool/sync", {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.token
      },
      method: "POST"
    });

    const failedAreas = result.sync.areas
      .filter((entry) => entry.status === "failed")
      .map((entry) => `${areaLabel(entry.area)} (${entry.errorCode ?? "Fehler"})`);

    elements.syncMessage.textContent =
      `${formatNumber(result.sync.storedTotal)} Datensätze aus ` +
      `${result.sync.succeeded} Bereichen gespeichert.` +
      (failedAreas.length > 0
        ? ` Fehlgeschlagen: ${failedAreas.join(", ")}.`
        : "");
    await loadDashboard();
  } catch (error) {
    elements.syncMessage.textContent =
      error instanceof Error
        ? error.message
        : "Der Datenabruf ist fehlgeschlagen.";
  } finally {
    elements.syncAll.removeAttribute("aria-busy");
    elements.syncAll.disabled = !discoveryAvailable;
  }
}

async function discoverMatoolStructure(): Promise<void> {
  elements.discoverStructure.disabled = true;
  elements.discoverStructure.setAttribute("aria-busy", "true");
  elements.discoveryResult.hidden = true;
  elements.actionMessage.textContent =
    "MATOOL-Struktur wird ohne Zellinhalte geprüft …";

  try {
    const csrf = await requestJson<{ token: string }>(
      "/api/admin/v1/csrf"
    );
    const result = await requestJson<DiscoveryResponse>(
      "/api/admin/v1/matool/discovery",
      {
        body: JSON.stringify({
          bereich: elements.discoveryArea.value
        }),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf.token
        },
        method: "POST"
      }
    );

    elements.actionMessage.textContent =
      "Struktur erfolgreich erkannt. Es wurden keine Zellinhalte übernommen.";
    renderDiscovery(result.discovery);
    await loadDashboard();
  } catch (error) {
    elements.actionMessage.textContent =
      error instanceof Error
        ? error.message
        : "Die Strukturprobe ist fehlgeschlagen.";
  } finally {
    elements.discoverStructure.removeAttribute("aria-busy");
    elements.discoverStructure.disabled = !discoveryAvailable;
  }
}

function renderDiscovery(
  discovery: DiscoveryResponse["discovery"]
): void {
  elements.discoverySummary.textContent =
    `HTTP ${discovery.status} · ${formatNumber(discovery.bodyBytes)} Bytes · ` +
    `${formatNumber(discovery.tableCount)} Tabellen · ` +
    `${formatNumber(discovery.rowCount)} Zeilen`;

  elements.discoveryTables.replaceChildren(
    ...discovery.tables.map((table) => {
      const item = document.createElement("li");
      const headers =
        table.headers.length > 0
          ? table.headers.join(" · ")
          : "keine Spaltenüberschriften";
      item.textContent =
        `Tabelle ${table.index + 1}: ${formatNumber(table.rowCount)} Zeilen · ` +
        headers;
      return item;
    })
  );

  elements.discoveryFields.replaceChildren(
    ...discovery.fields.map((field) => {
      const item = document.createElement("li");
      const type = field.type ? ` · Typ ${field.type}` : "";
      const options =
        field.optionCount === undefined
          ? ""
          : ` · ${formatNumber(field.optionCount)} Optionen`;
      item.textContent = `${field.element} · ${field.name}${type}${options}`;
      return item;
    })
  );

  elements.discoveryPatterns.replaceChildren(
    ...discovery.idPatterns.map((idPattern) => {
      const item = document.createElement("li");
      item.textContent =
        `${idPattern.attribute} · ${idPattern.pattern} · ` +
        `${formatNumber(idPattern.occurrences)}×`;
      return item;
    })
  );

  ensureListFallback(
    elements.discoveryTables,
    "Keine Tabellenstruktur erkannt."
  );
  ensureListFallback(
    elements.discoveryFields,
    "Keine benannten Formularfelder erkannt."
  );
  ensureListFallback(
    elements.discoveryPatterns,
    "Keine technischen ID-Muster erkannt."
  );
  elements.discoveryResult.hidden = false;
}

function ensureListFallback(
  list: HTMLUListElement,
  message: string
): void {
  if (list.childElementCount > 0) {
    return;
  }

  const item = document.createElement("li");
  item.textContent = message;
  list.append(item);
}

function renderGates(gates: SafetyGate[]): void {
  elements.gateList.replaceChildren(
    ...gates.map((gate) => {
      const item = document.createElement("li");
      const state = document.createElement("span");
      state.className =
        gate.state === "ready"
          ? "gate-state gate-ready"
          : "gate-state gate-open";
      state.setAttribute("aria-hidden", "true");

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const labels = gateLabels[gate.key] ?? [
        "Unbekanntes Gate",
        "Technische Prüfung erforderlich"
      ];
      title.textContent = labels[0];
      detail.textContent = labels[1];
      copy.append(title, detail);
      item.append(state, copy);
      return item;
    })
  );
}

function renderRuns(runs: RunSummary[]): void {
  if (runs.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty-state";
    cell.colSpan = 6;
    cell.textContent = "Noch keine Läufe vorhanden.";
    row.append(cell);
    elements.runsBody.replaceChildren(row);
    return;
  }

  elements.runsBody.replaceChildren(
    ...runs.map((run) => {
      const row = document.createElement("tr");
      appendCell(row, formatDateTime(run.startedAt));
      appendCell(row, modeLabel(run.mode));
      appendCell(row, runStatusLabel(run.status), `run-state ${run.status}`);
      appendCell(row, run.fetchedCount.toString());
      appendCell(row, run.candidateCount.toString());
      appendCell(row, run.eventCount.toString());
      return row;
    })
  );
}

function renderUnavailable(message: string): void {
  elements.overallStatus.textContent = "Status nicht verfügbar";
  elements.lastUpdated.textContent = message;
  elements.overallDot.className = "status-dot status-dot-error";
  elements.actionMessage.textContent =
    "Prüfe lokale Migration und Cloudflare-Access-Konfiguration.";
}

function appendCell(
  row: HTMLTableRowElement,
  value: string,
  className?: string
): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `Anfrage fehlgeschlagen (${response.status}).`
    );
  }
  return payload as T;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function setLoading(loading: boolean): void {
  elements.refresh.disabled = loading;
  elements.refresh.setAttribute("aria-busy", String(loading));
}

function modeLabel(mode: string): string {
  return (
    {
      active: "Aktiv",
      disabled: "Deaktiviert",
      dry_run: "Dry Run",
      shadow: "Shadow"
    }[mode] ?? mode
  );
}

function runStatusLabel(status: string): string {
  return (
    {
      failed: "Fehlgeschlagen",
      running: "Läuft",
      skipped: "Übersprungen",
      succeeded: "Erfolgreich"
    }[status] ?? status
  );
}

function environmentLabel(environment: string): string {
  return (
    {
      local: "Lokal",
      production: "Produktion",
      staging: "Staging",
      test: "Test"
    }[environment] ?? environment
  );
}

function channelLabel(channel: ProcessPolicy["contactChannel"]): string {
  if (!channel) {
    return "Noch festzulegen";
  }
  return (
    {
      email: "E-Mail",
      sms: "SMS",
      staff_task: "Mitarbeiter-Aufgabe"
    }[channel] ?? channel
  );
}

function minutesLabel(minutes: number | null): string {
  if (minutes === null) {
    return "Noch festzulegen";
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 Tag" : `${days} Tage`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 Stunde" : `${hours} Stunden`;
  }
  return `${minutes} Minuten`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unbekannt";
  }
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin"
  }).format(date);
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Fehlendes UI-Element: ${id}`);
  }
  return element as T;
}
