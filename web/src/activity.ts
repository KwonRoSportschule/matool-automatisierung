import { getActivity, isAbortError, type ActivityQuery } from "./api";
import {
  byId,
  createEmptyState,
  createStatusBadge,
  errorMessage,
  replaceSelectOptions,
  setRegionBusy
} from "./dom";
import {
  formatDateTime,
  formatNumber,
  kindLabel,
  runStatusLabel,
  toIsoBoundary
} from "./format";
import type { ActivityItem, AreaSummary, DashboardActivityResponse } from "./types";

export class ActivityView {
  private readonly area = byId<HTMLSelectElement>("activity-area");
  private readonly form = byId<HTMLFormElement>("activity-filters");
  private readonly from = byId<HTMLInputElement>("activity-from");
  private readonly kind = byId<HTMLSelectElement>("activity-kind");
  private readonly list = byId<HTMLOListElement>("activity-list");
  private readonly message = byId("activity-message");
  private readonly next = byId<HTMLButtonElement>("activity-next");
  private readonly pageLabel = byId("activity-page-label");
  private readonly pageSize = byId<HTMLSelectElement>("activity-page-size");
  private readonly previous = byId<HTMLButtonElement>("activity-previous");
  private readonly region = byId("activity-region");
  private readonly reset = byId<HTMLButtonElement>("activity-reset");
  private readonly status = byId<HTMLSelectElement>("activity-status");
  private readonly to = byId<HTMLInputElement>("activity-to");
  private abortController: AbortController | null = null;
  private page = 1;
  private totalPages = 1;

  constructor() {
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.page = 1;
      void this.load();
    });
    this.reset.addEventListener("click", () => {
      this.form.reset();
      this.page = 1;
      void this.load();
    });
    this.pageSize.addEventListener("change", () => {
      this.page = 1;
      void this.load();
    });
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
    replaceSelectOptions(
      this.area,
      areas.map((entry) => ({ label: entry.label, value: entry.key })),
      "Alle Bereiche"
    );
  }

  async load(): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    setRegionBusy(this.region, true);
    this.message.textContent = "Aktivitäten werden geladen …";
    try {
      const response = await getActivity(
        this.query(),
        this.abortController.signal
      );
      this.render(response);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.list.replaceChildren(
        createEmptyState(
          errorMessage(error, "Der Aktivitätsverlauf konnte nicht geladen werden.")
        )
      );
      this.message.textContent = "Aktivitäten momentan nicht verfügbar.";
      this.totalPages = 1;
      this.updatePagination(0);
    } finally {
      if (!this.abortController?.signal.aborted) {
        setRegionBusy(this.region, false);
      }
    }
  }

  private query(): ActivityQuery {
    return {
      area: this.area.value,
      from: toIsoBoundary(this.from.value, false),
      kind: this.kind.value,
      page: this.page,
      pageSize: Number.parseInt(this.pageSize.value, 10),
      status: this.status.value,
      to: toIsoBoundary(this.to.value, true)
    };
  }

  private render(response: DashboardActivityResponse): void {
    this.page = response.page;
    this.totalPages = Math.max(1, response.totalPages);
    this.message.textContent =
      response.total === 0
        ? "Keine Aktivitäten entsprechen den gewählten Filtern."
        : `${formatNumber(response.total)} Aktivitäten gefunden.`;
    if (response.activities.length === 0) {
      this.list.replaceChildren(
        createEmptyState("Für diese Auswahl gibt es noch keine Aktivitäten.")
      );
    } else {
      this.list.replaceChildren(
        ...response.activities.map((item) => activityItem(item))
      );
    }
    this.updatePagination(response.total);
  }

  private updatePagination(total: number): void {
    this.pageLabel.textContent =
      total === 0
        ? "Keine Seiten"
        : `Seite ${formatNumber(this.page)} von ${formatNumber(this.totalPages)}`;
    this.previous.disabled = this.page <= 1;
    this.next.disabled = this.page >= this.totalPages || total === 0;
  }
}

function activityItem(item: ActivityItem): HTMLLIElement {
  const entry = document.createElement("li");
  entry.className = "activity-entry";

  const rail = document.createElement("span");
  rail.className = "activity-rail";
  rail.dataset.state = statusState(item.status);
  rail.setAttribute("aria-hidden", "true");

  const content = document.createElement("article");
  const header = document.createElement("div");
  header.className = "activity-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent =
    item.title ?? item.summary ?? `${kindLabel(item.kind)}: ${runStatusLabel(item.status)}`;
  const meta = document.createElement("p");
  meta.className = "activity-meta";
  const time = document.createElement("time");
  time.dateTime = item.occurredAt;
  time.textContent = formatDateTime(item.occurredAt);
  meta.append(time);
  if (item.areaLabel || item.area) {
    meta.append(` · ${item.areaLabel ?? item.area}`);
  }
  meta.append(` · ${kindLabel(item.kind)}`);
  titleWrap.append(title, meta);
  header.append(titleWrap, createStatusBadge(statusState(item.status), runStatusLabel(item.status)));
  content.append(header);

  const description = item.description ?? (item.title ? item.summary : undefined);
  if (description) {
    const text = document.createElement("p");
    text.className = "activity-description";
    text.textContent = description;
    content.append(text);
  }
  const affected = item.affectedCount ?? item.count;
  if (affected !== null && affected !== undefined) {
    const count = document.createElement("p");
    count.className = "activity-count";
    count.textContent = `${formatNumber(affected)} betroffene Datensätze`;
    content.append(count);
  }

  const technical = safeTechnicalDetails(item);
  if (technical.length > 0) {
    const details = document.createElement("details");
    details.className = "technical-details";
    const summary = document.createElement("summary");
    summary.textContent = "Technische Details";
    const code = document.createElement("code");
    code.textContent = technical;
    details.append(summary, code);
    content.append(details);
  }
  entry.append(rail, content);
  return entry;
}

function safeTechnicalDetails(item: ActivityItem): string {
  if (item.technicalCode) {
    return item.technicalCode.slice(0, 300);
  }
  if (typeof item.technicalDetails === "string") {
    return item.technicalDetails.slice(0, 300);
  }
  if (!item.technicalDetails || Array.isArray(item.technicalDetails)) {
    return "";
  }
  const allowedEntries = Object.entries(item.technicalDetails)
    .filter(([key]) => !/(?:secret|token|password|email|phone|name|address)/iu.test(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 100)}`);
  return allowedEntries.join(" · ");
}

function statusState(status: string): string {
  if (status === "succeeded" || status === "info") {
    return "healthy";
  }
  if (status === "failed") {
    return "critical";
  }
  if (status === "warning" || status === "partial_failed") {
    return "warning";
  }
  return status === "running" ? "running" : "inactive";
}
