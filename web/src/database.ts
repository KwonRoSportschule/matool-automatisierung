import { getRecords, isAbortError, type RecordsQuery } from "./api";
import {
  byId,
  createEmptyState,
  createStatusBadge,
  errorMessage,
  replaceSelectOptions,
  setRegionBusy
} from "./dom";
import { changeLabel, formatDateTime, formatNumber } from "./format";
import { RecordDetailDialog } from "./record-detail";
import type {
  AreaSummary,
  DashboardColumn,
  DashboardRecord,
  DashboardRecordsResponse
} from "./types";

export class DatabaseView {
  private readonly area = byId<HTMLSelectElement>("database-area");
  private readonly cards = byId("database-cards");
  private readonly change = byId<HTMLSelectElement>("database-change");
  private readonly direction = byId<HTMLSelectElement>("database-direction");
  private readonly form = byId<HTMLFormElement>("database-filters");
  private readonly head = byId<HTMLTableSectionElement>("database-head");
  private readonly message = byId("database-message");
  private readonly next = byId<HTMLButtonElement>("database-next");
  private readonly pageLabel = byId("database-page-label");
  private readonly pageSize = byId<HTMLSelectElement>("database-page-size");
  private readonly previous = byId<HTMLButtonElement>("database-previous");
  private readonly query = byId<HTMLInputElement>("database-query");
  private readonly region = byId("database-region");
  private readonly reset = byId<HTMLButtonElement>("database-reset");
  private readonly sort = byId<HTMLSelectElement>("database-sort");
  private readonly body = byId<HTMLTableSectionElement>("database-body");
  private abortController: AbortController | null = null;
  private readonly detail: RecordDetailDialog;
  private page = 1;
  private totalPages = 1;

  constructor(detail: RecordDetailDialog) {
    this.detail = detail;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.page = 1;
      void this.load();
    });
    this.reset.addEventListener("click", () => {
      const selectedArea = this.area.value;
      this.form.reset();
      this.area.value = selectedArea;
      this.page = 1;
      void this.load();
    });
    for (const element of [
      this.area,
      this.change,
      this.direction,
      this.pageSize,
      this.sort
    ]) {
      element.addEventListener("change", () => {
        this.page = 1;
        void this.load();
      });
    }
    this.previous.addEventListener("click", () => {
      if (this.page > 1) {
        this.page -= 1;
        void this.load();
      }
    });
    this.next.addEventListener("click", () => {
      if (this.page < this.totalPages) {
        this.page += 1;
        void this.load();
      }
    });
  }

  setAreas(areas: readonly AreaSummary[]): void {
    const before = this.area.value;
    replaceSelectOptions(
      this.area,
      areas.map((entry) => ({ label: entry.label, value: entry.key }))
    );
    if (before && areas.some((entry) => entry.key === before)) {
      this.area.value = before;
    } else if (areas[0]) {
      this.area.value = areas[0].key;
    }
  }

  async load(): Promise<void> {
    if (!this.area.value) {
      this.renderEmpty("Noch kein Datenbereich verfügbar.");
      return;
    }
    this.abortController?.abort();
    this.abortController = new AbortController();
    setRegionBusy(this.region, true);
    this.message.textContent = "Datensätze werden geladen …";
    try {
      const response = await getRecords(
        this.currentQuery(),
        this.abortController.signal
      );
      this.render(response);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.renderEmpty(
        errorMessage(error, "Die Datenbankansicht konnte nicht geladen werden.")
      );
      this.message.textContent = "Datensätze momentan nicht verfügbar.";
      this.totalPages = 1;
      this.updatePagination(0, 0);
    } finally {
      if (!this.abortController?.signal.aborted) {
        setRegionBusy(this.region, false);
      }
    }
  }

  private currentQuery(): RecordsQuery {
    return {
      area: this.area.value,
      change: this.change.value,
      direction: this.direction.value === "asc" ? "asc" : "desc",
      page: this.page,
      pageSize: Number.parseInt(this.pageSize.value, 10),
      query: this.query.value,
      sort: this.sort.value
    };
  }

  private render(response: DashboardRecordsResponse): void {
    this.page = response.page;
    this.totalPages = Math.max(1, response.totalPages);
    const visibleColumns = response.columns.slice(0, 4);
    this.renderHead(visibleColumns);
    if (response.records.length === 0) {
      this.renderEmpty("Für diese Auswahl wurden keine Datensätze gefunden.");
    } else {
      this.body.replaceChildren(
        ...response.records.map((record) =>
          this.recordRow(response.area, record, visibleColumns)
        )
      );
      this.cards.replaceChildren(
        ...response.records.map((record) =>
          this.recordCard(response.area, record, visibleColumns)
        )
      );
    }
    const first = response.total === 0 ? 0 : (response.page - 1) * response.pageSize + 1;
    const last = Math.min(response.total, first + response.records.length - 1);
    this.message.textContent =
      response.total === 0
        ? `Keine Datensätze in „${response.label}“ gefunden.`
        : `${formatNumber(first)}–${formatNumber(last)} von ${formatNumber(response.total)} Datensätzen in „${response.label}“.`;
    this.updatePagination(response.total, response.records.length);
  }

  private renderHead(columns: readonly DashboardColumn[]): void {
    const row = document.createElement("tr");
    for (const label of [
      "Referenz",
      "Änderung",
      "Zuletzt geändert",
      ...columns.map((column) => column.label),
      "Details"
    ]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      row.append(cell);
    }
    this.head.replaceChildren(row);
  }

  private recordRow(
    area: string,
    record: DashboardRecord,
    columns: readonly DashboardColumn[]
  ): HTMLTableRowElement {
    const row = document.createElement("tr");
    appendCell(row, record.recordRef);
    const changeCell = document.createElement("td");
    changeCell.append(createStatusBadge(changeState(record.change), changeLabel(record.change)));
    row.append(changeCell);
    appendCell(row, formatDateTime(record.lastChangedAt));
    for (const column of columns) {
      appendCell(row, record.values[column.key] ?? "—", "truncate-cell");
    }
    const actions = document.createElement("td");
    actions.append(this.detailButton(area, record));
    row.append(actions);
    return row;
  }

  private recordCard(
    area: string,
    record: DashboardRecord,
    columns: readonly DashboardColumn[]
  ): HTMLElement {
    const card = document.createElement("article");
    card.className = "database-card";
    const header = document.createElement("div");
    header.className = "database-card-header";
    const reference = document.createElement("strong");
    reference.textContent = record.recordRef;
    header.append(
      reference,
      createStatusBadge(changeState(record.change), changeLabel(record.change))
    );
    const meta = document.createElement("p");
    meta.textContent = `Zuletzt geändert: ${formatDateTime(record.lastChangedAt)}`;
    const values = document.createElement("dl");
    for (const column of columns.slice(0, 3)) {
      const group = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = column.label;
      const value = document.createElement("dd");
      value.textContent = record.values[column.key] ?? "—";
      group.append(term, value);
      values.append(group);
    }
    card.append(header, meta, values, this.detailButton(area, record));
    return card;
  }

  private detailButton(area: string, record: DashboardRecord): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "button button-small button-secondary";
    button.type = "button";
    button.textContent = "Details öffnen";
    button.setAttribute("aria-label", `Details zu Datensatz ${record.recordRef} öffnen`);
    button.addEventListener("click", () => {
      void this.detail.open(area, record.publicId, button);
    });
    return button;
  }

  private renderEmpty(message: string): void {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = Math.max(1, this.head.querySelectorAll("th").length);
    cell.className = "empty-state";
    cell.textContent = message;
    row.append(cell);
    this.body.replaceChildren(row);
    this.cards.replaceChildren(createEmptyState(message));
  }

  private updatePagination(total: number, visible: number): void {
    this.pageLabel.textContent =
      total === 0
        ? "Keine Seiten"
        : `Seite ${formatNumber(this.page)} von ${formatNumber(this.totalPages)}`;
    this.previous.disabled = this.page <= 1;
    this.next.disabled = this.page >= this.totalPages || visible === 0;
  }
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
    cell.title = value;
  }
  row.append(cell);
}

function changeState(change: string): string {
  if (change === "created") {
    return "healthy";
  }
  if (change === "updated") {
    return "warning";
  }
  return "inactive";
}
