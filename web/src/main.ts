import { ActivityView } from "./activity";
import {
  getOverview,
  isAbortError,
  runDiscovery,
  runMatoolSync
} from "./api";
import { renderChangeChart, renderRunChart } from "./charts";
import { DatabaseView } from "./database";
import {
  byId,
  createEmptyState,
  createStatusBadge,
  errorMessage,
  replaceSelectOptions,
  setRegionBusy
} from "./dom";
import {
  executionLabel,
  formatDateTime,
  formatDelay,
  formatEnvironment,
  formatNumber,
  functionStateLabel,
  runStatusLabel,
  setTimeText,
  stateLabel
} from "./format";
import { RecordDetailDialog } from "./record-detail";
import type {
  AreaSummary,
  ConnectionSummary,
  DashboardOverview,
  DashboardState,
  DiscoveryResponse,
  FunctionSummary,
  WarningSummary
} from "./types";

const elements = {
  environment: byId("environment"),
  refresh: byId<HTMLButtonElement>("refresh"),
  privacyShort: byId("privacy-short"),
  privacyNotice: byId("privacy-notice"),
  overallPanel: byId("overall-panel"),
  overallSymbol: byId("overall-symbol"),
  overallLabel: byId("overall-label"),
  overallSummary: byId("overall-summary"),
  overallAction: byId("overall-action"),
  overallReasons: byId("overall-reasons"),
  lastUpdated: byId("last-updated"),
  warningsSection: byId("warnings-section"),
  warningCount: byId("warning-count"),
  warningsList: byId("warnings-list"),
  connectionsGrid: byId("connections-grid"),
  overviewRange: byId<HTMLSelectElement>("overview-range"),
  metricsGrid: byId("metrics-grid"),
  runsChart: byId("runs-chart"),
  changesChart: byId("changes-chart"),
  areaSummary: byId("area-summary"),
  areasBody: byId<HTMLTableSectionElement>("areas-body"),
  areasCards: byId("areas-cards"),
  scheduleState: byId("schedule-state"),
  scheduleDescription: byId("schedule-description"),
  schedulePrevious: byId<HTMLTimeElement>("schedule-previous"),
  scheduleActual: byId<HTMLTimeElement>("schedule-actual"),
  scheduleCompleted: byId<HTMLTimeElement>("schedule-completed"),
  scheduleNext: byId<HTMLTimeElement>("schedule-next"),
  scheduleDelay: byId("schedule-delay"),
  scheduleTimezone: byId("schedule-timezone"),
  scheduleAreas: byId("schedule-areas"),
  functionCount: byId("function-count"),
  functionsList: byId("functions-list"),
  adminSync: byId<HTMLButtonElement>("admin-sync"),
  adminSyncMessage: byId("admin-sync-message"),
  discoveryArea: byId<HTMLSelectElement>("discovery-area"),
  discoveryRun: byId<HTMLButtonElement>("discovery-run"),
  discoveryMessage: byId("discovery-message"),
  discoveryResult: byId("discovery-result")
};

const detailDialog = new RecordDetailDialog();
const activityView = new ActivityView();
const databaseView = new DatabaseView(detailDialog);

let overviewAbortController: AbortController | null = null;
let currentOverview: DashboardOverview | null = null;
let adminAvailable = false;

elements.refresh.addEventListener("click", () => {
  void refreshAll();
});

elements.overviewRange.addEventListener("change", () => {
  void loadOverview();
});

elements.adminSync.addEventListener("click", () => {
  void runManualSync();
});

elements.discoveryRun.addEventListener("click", () => {
  void runStructureDiscovery();
});

void refreshAll();

async function refreshAll(): Promise<void> {
  setRefreshBusy(true);
  try {
    const loaded = await loadOverview();
    if (loaded) {
      await Promise.all([activityView.load(), databaseView.load()]);
    }
  } finally {
    setRefreshBusy(false);
  }
}

async function loadOverview(): Promise<boolean> {
  overviewAbortController?.abort();
  const controller = new AbortController();
  overviewAbortController = controller;
  setOverviewBusy(true);

  try {
    const overview = await getOverview(selectedRange(), controller.signal);
    if (controller.signal.aborted) {
      return false;
    }
    currentOverview = overview;
    renderOverview(overview);
    activityView.setAreas(overview.areas);
    databaseView.setAreas(overview.areas);
    configureAdminTools(overview);
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      return false;
    }
    renderOverviewError(
      errorMessage(
        error,
        "Die Betriebsübersicht konnte momentan nicht geladen werden."
      )
    );
    return false;
  } finally {
    if (overviewAbortController === controller) {
      setOverviewBusy(false);
    }
  }
}

function renderOverview(overview: DashboardOverview): void {
  elements.environment.textContent =
    `${formatEnvironment(overview.environment)} · Nur Lesen`;
  elements.privacyShort.textContent = overview.privacy.masked
    ? "Serverseitig maskiert"
    : "Klartext · Testphase";
  elements.privacyNotice.textContent = overview.privacy.notice;

  renderOverall(overview);
  renderWarnings(overview.warnings);
  renderConnections(overview.connections);
  renderMetrics(overview);
  renderRunChart(elements.runsChart, overview.charts.points);
  renderChangeChart(elements.changesChart, overview.charts.points);
  renderAreas(overview.areas, overview.metrics.areasWithData);
  renderSchedule(overview);
  renderFunctions(overview.functions, overview.areas);

  elements.runsChart.setAttribute("aria-busy", "false");
  elements.changesChart.setAttribute("aria-busy", "false");
}

function renderOverall(overview: DashboardOverview): void {
  const { overall } = overview;
  const symbol: Record<DashboardState, string> = {
    critical: "×",
    healthy: "✓",
    inactive: "–",
    unknown: "?",
    warning: "!"
  };
  elements.overallPanel.dataset.state = overall.state;
  elements.overallSymbol.dataset.state = overall.state;
  elements.overallSymbol.textContent = symbol[overall.state];
  elements.overallLabel.textContent = overall.label || stateLabel(overall.state);
  elements.overallSummary.textContent = overall.summary;
  elements.overallAction.textContent =
    overall.recommendedAction ?? "Aktuell ist keine Maßnahme erforderlich.";
  elements.overallReasons.textContent =
    overall.reasonCount === 0
      ? "Keine offenen Hinweise"
      : overall.reasonCount === 1
        ? "1 Hinweis beeinflusst den Status"
        : `${formatNumber(overall.reasonCount)} Hinweise beeinflussen den Status`;
  elements.lastUpdated.textContent =
    `Datenstand: ${formatDateTime(overview.generatedAt)}`;
  if (elements.lastUpdated instanceof HTMLTimeElement) {
    elements.lastUpdated.dateTime = overview.generatedAt;
  }
}

function renderWarnings(warnings: readonly WarningSummary[]): void {
  const empty = warnings.length === 0;
  elements.warningsSection.dataset.empty = String(empty);
  elements.warningCount.textContent = empty
    ? "Keine Warnungen"
    : warnings.length === 1
      ? "1 Hinweis"
      : `${formatNumber(warnings.length)} Hinweise`;
  if (empty) {
    elements.warningsList.replaceChildren(
      createEmptyState("Aktuell gibt es keine Warnungen oder offenen Störungen.")
    );
    return;
  }
  elements.warningsList.replaceChildren(
    ...warnings.map((warning) => warningCard(warning))
  );
}

function warningCard(warning: WarningSummary): HTMLElement {
  const item = document.createElement("article");
  item.className = "warning-item";
  item.dataset.state = warning.state;

  const icon = document.createElement("span");
  icon.className = "warning-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = warning.state === "critical" ? "×" : "!";

  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = warning.title;
  const impact = document.createElement("p");
  impact.textContent = warning.impact;
  copy.append(title, impact);

  const details = [warning.action, warning.technicalCode]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  if (details) {
    const small = document.createElement("small");
    small.textContent = details;
    copy.append(small);
  }

  const time = document.createElement("time");
  if (warning.occurredAt) {
    time.dateTime = warning.occurredAt;
    time.textContent = formatDateTime(warning.occurredAt);
  } else {
    time.textContent = "Aktueller Hinweis";
  }
  item.append(icon, copy, time);
  return item;
}

function renderConnections(
  connections: DashboardOverview["connections"]
): void {
  const definitions = [
    { key: "matool", label: "MATOOL" },
    { key: "database", label: "Cloudflare D1" },
    { key: "schedule", label: "Zeitplan" },
    { key: "zapier", label: "Zapier" }
  ] as const;
  elements.connectionsGrid.replaceChildren(
    ...definitions.map(({ key, label }) =>
      connectionCard(
        connections[key] ?? missingConnection(key, label)
      )
    )
  );
}

function missingConnection(key: string, label: string): ConnectionSummary {
  return {
    action: "Die Statusprüfung erneut ausführen.",
    checkedAt: null,
    description: "Für diese Verbindung liegen noch keine Prüfdaten vor.",
    key,
    label,
    lastActivityAt: null,
    lastError: null,
    lastSuccessAt: null,
    state: "unknown",
    statusLabel: "Noch nicht geprüft"
  };
}

function connectionCard(connection: ConnectionSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "connection-card";
  card.dataset.state = connection.state;

  const header = document.createElement("div");
  header.className = "connection-title";
  const title = document.createElement("h3");
  title.textContent = connection.label;
  header.append(title, createStatusBadge(connection.state, stateLabel(connection.state)));

  const status = document.createElement("strong");
  status.textContent = connection.statusLabel;
  const description = document.createElement("p");
  description.textContent = connection.description;

  const times = document.createElement("dl");
  times.className = "connection-times";
  appendDefinition(times, "Letzte Aktivität", formatDateTime(connection.lastActivityAt));
  appendDefinition(times, "Letzter Erfolg", formatDateTime(connection.lastSuccessAt));
  appendDefinition(times, "Zuletzt geprüft", formatDateTime(connection.checkedAt));

  card.append(header, status, description, times);

  const notes: string[] = [];
  if (connection.action) {
    notes.push(connection.action);
  }
  if (connection.lastError) {
    notes.push(
      `Letzter Fehler: ${connection.lastError.code ?? "ohne technischen Code"} · ${formatDateTime(connection.lastError.at)}`
    );
  }
  if (connection.activeSubscriptions !== undefined) {
    notes.push(
      `${formatNumber(connection.activeSubscriptions)} aktive Zapier-Verbindung(en)`
    );
  }
  if (connection.pendingOutbox !== undefined) {
    notes.push(`${formatNumber(connection.pendingOutbox)} wartende Ausgabe(n)`);
  }
  if (notes.length > 0) {
    const action = document.createElement("p");
    action.className = "connection-action";
    action.textContent = notes.join(" · ");
    card.append(action);
  }
  return card;
}

function renderMetrics(overview: DashboardOverview): void {
  const { metrics } = overview;
  const rangeText =
    overview.range.days === 1
      ? "in den letzten 24 Stunden"
      : `in den letzten ${overview.range.days} Tagen`;
  const cards = [
    {
      label: "Gespeicherte Datensätze",
      value: metrics.storedRecords,
      detail: "aktueller Bestand in Cloudflare D1"
    },
    {
      label: "Bereiche mit Daten",
      value: metrics.areasWithData,
      detail: `von ${formatNumber(metrics.monitoredAreas)} überwachten Bereichen`
    },
    { label: "Neue Datensätze", value: metrics.newRecords, detail: rangeText },
    { label: "Geänderte Datensätze", value: metrics.changedRecords, detail: rangeText },
    { label: "Erfolgreiche Läufe", value: metrics.successfulRuns, detail: rangeText },
    { label: "Fehlgeschlagene Läufe", value: metrics.failedRuns, detail: rangeText },
    {
      label: "Überwachte Bereiche",
      value: metrics.monitoredAreas,
      detail: "vollständiger MATOOL-Umfang"
    }
  ];
  elements.metricsGrid.replaceChildren(
    ...cards.map((metric) => {
      const card = document.createElement("article");
      card.className = "metric-card";
      const label = document.createElement("span");
      label.textContent = metric.label;
      const value = document.createElement("strong");
      value.textContent = formatNumber(metric.value);
      const detail = document.createElement("small");
      detail.textContent = metric.detail;
      card.append(label, value, detail);
      return card;
    })
  );
}

function renderAreas(
  areas: readonly AreaSummary[],
  areasWithData: number
): void {
  elements.areaSummary.textContent =
    `${formatNumber(areasWithData)} von ${formatNumber(areas.length)} mit Daten`;
  if (areas.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-state";
    cell.textContent = "Noch keine Datenbereiche verfügbar.";
    row.append(cell);
    elements.areasBody.replaceChildren(row);
    elements.areasCards.replaceChildren(
      createEmptyState("Noch keine Datenbereiche verfügbar.")
    );
    return;
  }
  elements.areasBody.replaceChildren(...areas.map((area) => areaRow(area)));
  elements.areasCards.replaceChildren(...areas.map((area) => areaCard(area)));
}

function areaRow(area: AreaSummary): HTMLTableRowElement {
  const row = document.createElement("tr");
  const name = document.createElement("td");
  name.className = "area-name";
  const label = document.createElement("strong");
  label.textContent = area.label;
  const key = document.createElement("small");
  key.textContent = area.key;
  name.append(label, key);
  row.append(name);

  const state = document.createElement("td");
  state.append(createStatusBadge(area.state, stateLabel(area.state)));
  row.append(state);
  appendAreaCountCell(row, area.storedCount, area.currentCount);
  appendCell(row, formatNumber(area.newCount));
  appendCell(row, formatNumber(area.changedCount));
  appendCell(row, formatDateTime(area.lastChangedAt));

  const lastRun = document.createElement("td");
  if (area.lastRun) {
    lastRun.append(
      createStatusBadge(
        area.lastRun.status === "succeeded" ? "healthy" : "critical",
        runStatusLabel(area.lastRun.status)
      ),
      document.createElement("br"),
      formatDateTime(area.lastRun.startedAt)
    );
  } else {
    lastRun.textContent = "Noch kein Abruf";
  }
  row.append(lastRun);
  return row;
}

function areaCard(area: AreaSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "area-card";
  const header = document.createElement("div");
  header.className = "area-card-header";
  const title = document.createElement("h3");
  title.textContent = area.label;
  header.append(title, createStatusBadge(area.state, stateLabel(area.state)));
  const list = document.createElement("dl");
  appendDefinition(list, "Gespeichert", formatNumber(area.storedCount));
  appendDefinition(list, "Aktuell", formatNumber(area.currentCount));
  appendDefinition(list, "Neu", formatNumber(area.newCount));
  appendDefinition(list, "Geändert", formatNumber(area.changedCount));
  appendDefinition(list, "Letzte Änderung", formatDateTime(area.lastChangedAt));
  appendDefinition(
    list,
    "Letzter Abruf",
    area.lastRun
      ? `${runStatusLabel(area.lastRun.status)} · ${formatDateTime(area.lastRun.startedAt)}`
      : "Noch nicht vorhanden"
  );
  card.append(header, list);
  return card;
}

function renderSchedule(overview: DashboardOverview): void {
  const { schedule } = overview;
  const connection = overview.connections.schedule;
  const scheduleState = connection?.state ?? "unknown";
  const dot = document.createElement("span");
  dot.className = "status-indicator";
  dot.setAttribute("aria-hidden", "true");
  elements.scheduleState.dataset.state = scheduleState;
  elements.scheduleState.replaceChildren(
    dot,
    connection?.statusLabel ??
      (schedule.lastStatus
        ? runStatusLabel(schedule.lastStatus)
        : "Noch kein automatischer Lauf")
  );
  elements.scheduleDescription.textContent =
    `${schedule.description} Technischer Zeitplan: ${schedule.technicalCron}.`;
  setTimeText(elements.schedulePrevious, schedule.previousScheduledAt);
  setTimeText(elements.scheduleActual, schedule.lastActualAt);
  setTimeText(elements.scheduleCompleted, schedule.lastCompletedAt);
  setTimeText(elements.scheduleNext, schedule.nextScheduledAt);
  elements.scheduleDelay.textContent = formatDelay(connection?.delayMinutes);
  elements.scheduleTimezone.textContent = schedule.timeZone ?? "Europe/Berlin";

  const areaLabels = new Map(
    overview.areas.map((area) => [area.key, area.label] as const)
  );
  elements.scheduleAreas.textContent =
    schedule.affectedAreas.length === 0
      ? "Keine Datenbereiche im Zeitplan hinterlegt."
      : `Geplante Bereiche (${formatNumber(schedule.affectedAreas.length)}): ${schedule.affectedAreas
          .map((area) => areaLabels.get(area) ?? area)
          .join(", ")}.`;
}

function renderFunctions(
  functions: readonly FunctionSummary[],
  areas: readonly AreaSummary[]
): void {
  elements.functionCount.textContent =
    functions.length === 1
      ? "1 Funktion"
      : `${formatNumber(functions.length)} Funktionen`;
  if (functions.length === 0) {
    elements.functionsList.replaceChildren(
      createEmptyState("Noch keine Funktionen gemeldet.")
    );
    return;
  }
  const areaLabels = new Map(areas.map((area) => [area.key, area.label] as const));
  elements.functionsList.replaceChildren(
    ...functions.map((feature) => functionCard(feature, areaLabels))
  );
}

function functionCard(
  feature: FunctionSummary,
  areaLabels: ReadonlyMap<string, string>
): HTMLElement {
  const item = document.createElement("article");
  item.className = "function-item";
  const header = document.createElement("div");
  header.className = "function-header";
  const title = document.createElement("h3");
  title.textContent = feature.name;
  header.append(
    title,
    createStatusBadge(functionState(feature.state), functionStateLabel(feature.state))
  );
  const description = document.createElement("p");
  description.textContent = feature.description;
  const meta = document.createElement("div");
  meta.className = "function-meta";
  appendChip(meta, executionLabel(feature.execution));
  appendChip(
    meta,
    feature.lastRunAt
      ? `Zuletzt: ${formatDateTime(feature.lastRunAt)}`
      : "Noch nicht ausgeführt"
  );
  if (feature.areas.length > 0) {
    appendChip(
      meta,
      `Bereiche: ${feature.areas.map((area) => areaLabels.get(area) ?? area).join(", ")}`
    );
  }
  if (feature.dependencies.length > 0) {
    appendChip(meta, `Benötigt: ${feature.dependencies.join(", ")}`);
  }
  item.append(header, description, meta);
  return item;
}

function configureAdminTools(overview: DashboardOverview): void {
  const matool = overview.connections.matool;
  const hasEmployeeAccess = overview.access.canManage;
  const matoolAvailable =
    matool?.configured === true && matool.state !== "critical";
  adminAvailable = hasEmployeeAccess && matoolAvailable;
  elements.adminSync.disabled = !adminAvailable;
  elements.discoveryRun.disabled = !adminAvailable;
  elements.adminSync.textContent = hasEmployeeAccess
    ? adminAvailable
      ? "Manuellen Abruf starten"
      : "MATOOL-Verbindung nicht verfügbar"
    : "Cloudflare-Access-Anmeldung erforderlich";
  elements.discoveryRun.textContent = hasEmployeeAccess
    ? adminAvailable
      ? "Struktur erkennen"
      : "Strukturprüfung nicht verfügbar"
    : "Cloudflare-Access-Anmeldung erforderlich";

  if (!hasEmployeeAccess) {
    elements.adminSyncMessage.textContent = overview.access.notice;
    elements.discoveryMessage.textContent = overview.access.notice;
  }
  replaceSelectOptions(
    elements.discoveryArea,
    overview.areas.map((area) => ({ label: area.label, value: area.key }))
  );
  elements.discoveryArea.disabled = !adminAvailable || overview.areas.length === 0;
  elements.discoveryRun.disabled =
    !adminAvailable || overview.areas.length === 0;
}

async function runManualSync(): Promise<void> {
  if (!adminAvailable) {
    return;
  }
  elements.adminSync.disabled = true;
  elements.adminSync.setAttribute("aria-busy", "true");
  elements.adminSyncMessage.textContent =
    "Alle freigegebenen MATOOL-Bereiche werden gelesen und in D1 gespeichert …";
  try {
    const response = await runMatoolSync();
    const failed = response.sync.areas
      .filter((area) => area.status === "failed")
      .map((area) => areaLabel(area.area));
    elements.adminSyncMessage.textContent =
      `${formatNumber(response.sync.storedTotal)} Datensätze gespeichert · ` +
      `${formatNumber(response.sync.succeeded)} Bereiche erfolgreich` +
      (failed.length > 0
        ? ` · Fehlgeschlagen: ${failed.join(", ")}`
        : " · Keine Bereichsfehler");
    await refreshAll();
  } catch (error) {
    elements.adminSyncMessage.textContent = errorMessage(
      error,
      "Der manuelle MATOOL-Abruf ist fehlgeschlagen."
    );
  } finally {
    elements.adminSync.removeAttribute("aria-busy");
    elements.adminSync.disabled = !adminAvailable;
  }
}

async function runStructureDiscovery(): Promise<void> {
  const area = elements.discoveryArea.value;
  if (!adminAvailable || !area) {
    elements.discoveryMessage.textContent =
      "Bitte zuerst einen verfügbaren Datenbereich auswählen.";
    return;
  }
  elements.discoveryRun.disabled = true;
  elements.discoveryRun.setAttribute("aria-busy", "true");
  elements.discoveryResult.hidden = true;
  elements.discoveryMessage.textContent =
    "Die technische MATOOL-Struktur wird ohne Zellinhalte geprüft …";
  try {
    const response = await runDiscovery(area);
    renderDiscovery(response);
    elements.discoveryMessage.textContent =
      "Struktur erfolgreich erkannt. Es wurden keine Zellinhalte angezeigt.";
  } catch (error) {
    elements.discoveryMessage.textContent = errorMessage(
      error,
      "Die Strukturprüfung ist fehlgeschlagen."
    );
  } finally {
    elements.discoveryRun.removeAttribute("aria-busy");
    elements.discoveryRun.disabled = !adminAvailable;
  }
}

function renderDiscovery(response: DiscoveryResponse): void {
  const { discovery } = response;
  const summary = document.createElement("p");
  summary.textContent =
    `HTTP ${discovery.status} · ${formatNumber(discovery.bodyBytes)} Bytes · ` +
    `${formatNumber(discovery.tableCount)} Tabellen · ` +
    `${formatNumber(discovery.rowCount)} Zeilen`;

  const tables = discoverySection(
    "Erkannte Tabellen",
    discovery.tables.map((table) => {
      const headers =
        table.headers.length > 0
          ? table.headers.join(" · ")
          : "keine Spaltenüberschriften";
      return `Tabelle ${table.index + 1}: ${formatNumber(table.rowCount)} Zeilen · ${headers}`;
    }),
    "Keine Tabellenstruktur erkannt."
  );
  const fields = discoverySection(
    "Erkannte Formularfelder",
    discovery.fields.map((field) => {
      const type = field.type ? ` · Typ ${field.type}` : "";
      const options =
        field.optionCount === undefined
          ? ""
          : ` · ${formatNumber(field.optionCount)} Optionen`;
      return `${field.element} · ${field.name}${type}${options}`;
    }),
    "Keine benannten Formularfelder erkannt."
  );
  const patterns = discoverySection(
    "Technische ID-Muster",
    discovery.idPatterns.map(
      (pattern) =>
        `${pattern.attribute} · ${pattern.pattern} · ${formatNumber(pattern.occurrences)}×`
    ),
    "Keine technischen ID-Muster erkannt."
  );
  elements.discoveryResult.replaceChildren(summary, tables, fields, patterns);
  elements.discoveryResult.hidden = false;
}

function discoverySection(
  title: string,
  values: readonly string[],
  fallback: string
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const value of values.length > 0 ? values : [fallback]) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function renderOverviewError(message: string): void {
  currentOverview = null;
  elements.environment.textContent = "Status nicht verfügbar";
  elements.privacyShort.textContent = "Anzeige vorsorglich gesperrt";
  elements.privacyNotice.textContent =
    "Ohne bestätigte serverseitige Maskierung werden keine Daten angezeigt.";
  elements.overallPanel.dataset.state = "critical";
  elements.overallSymbol.dataset.state = "critical";
  elements.overallSymbol.textContent = "×";
  elements.overallLabel.textContent = "Betriebsdaten nicht verfügbar";
  elements.overallSummary.textContent = message;
  elements.overallAction.textContent =
    "Status erneut laden. Bei wiederholtem Fehler die Worker-Protokolle prüfen.";
  elements.overallReasons.textContent = "Keine zuverlässige Gesamtbewertung möglich";
  elements.lastUpdated.textContent = "Letzter Ladeversuch fehlgeschlagen";

  elements.warningsSection.dataset.empty = "false";
  elements.warningCount.textContent = "Ladefehler";
  elements.warningsList.replaceChildren(createEmptyState(message));
  elements.connectionsGrid.replaceChildren(createEmptyState(message));
  elements.metricsGrid.replaceChildren(createEmptyState(message));
  elements.runsChart.replaceChildren(createEmptyState(message));
  elements.changesChart.replaceChildren(createEmptyState(message));
  elements.areaSummary.textContent = "Nicht verfügbar";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.className = "empty-state";
  cell.textContent = message;
  row.append(cell);
  elements.areasBody.replaceChildren(row);
  elements.areasCards.replaceChildren(createEmptyState(message));
  elements.scheduleState.dataset.state = "unknown";
  elements.scheduleState.textContent = "Nicht verfügbar";
  elements.scheduleDescription.textContent = message;
  elements.functionCount.textContent = "Nicht verfügbar";
  elements.functionsList.replaceChildren(createEmptyState(message));
  adminAvailable = false;
  elements.adminSync.disabled = true;
  elements.discoveryRun.disabled = true;
  elements.discoveryArea.disabled = true;
}

function setOverviewBusy(busy: boolean): void {
  for (const region of [
    elements.overallPanel,
    elements.warningsList,
    elements.connectionsGrid,
    elements.metricsGrid,
    elements.runsChart,
    elements.changesChart,
    elements.areasBody,
    elements.functionsList
  ]) {
    setRegionBusy(region, busy);
  }
  elements.overviewRange.disabled = busy;
}

function setRefreshBusy(busy: boolean): void {
  elements.refresh.disabled = busy;
  elements.refresh.setAttribute("aria-busy", String(busy));
  const label = elements.refresh.querySelector<HTMLElement>("span:last-child");
  if (label) {
    label.textContent = busy ? "Wird aktualisiert …" : "Status aktualisieren";
  }
}

function selectedRange(): 1 | 7 | 30 | 90 {
  const value = Number(elements.overviewRange.value);
  return value === 1 || value === 30 || value === 90 ? value : 7;
}

function appendDefinition(
  list: HTMLDListElement,
  termText: string,
  valueText: string
): void {
  const group = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = termText;
  const value = document.createElement("dd");
  value.textContent = valueText;
  group.append(term, value);
  list.append(group);
}

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
}

function appendAreaCountCell(
  row: HTMLTableRowElement,
  stored: number,
  current: number
): void {
  const cell = document.createElement("td");
  const total = document.createElement("strong");
  total.textContent = formatNumber(stored);
  const currentValue = document.createElement("small");
  currentValue.textContent = `${formatNumber(current)} aktuell`;
  currentValue.style.display = "block";
  cell.append(total, currentValue);
  row.append(cell);
}

function appendChip(container: HTMLElement, text: string): void {
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.textContent = text;
  container.append(chip);
}

function functionState(state: string): DashboardState {
  if (state === "enabled") {
    return "healthy";
  }
  if (state === "disabled") {
    return "inactive";
  }
  return state === "unavailable" ? "warning" : "unknown";
}

function areaLabel(key: string): string {
  return currentOverview?.areas.find((area) => area.key === key)?.label ?? key;
}
