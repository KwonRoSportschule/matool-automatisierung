import { getRecordDetail, isAbortError } from "./api";
import {
  byId,
  createEmptyState,
  createStatusBadge,
  errorMessage,
  setRegionBusy
} from "./dom";
import { changeLabel, formatDateTime } from "./format";
import type { DashboardRecordDetail } from "./types";

export class RecordDetailDialog {
  private readonly closeButton = byId<HTMLButtonElement>("record-dialog-close");
  private readonly content = byId("record-dialog-content");
  private readonly dialog = byId<HTMLDialogElement>("record-dialog");
  private readonly subtitle = byId("record-dialog-subtitle");
  private readonly title = byId("record-dialog-title");
  private abortController: AbortController | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.closeButton.addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) {
        this.dialog.close();
      }
    });
    this.dialog.addEventListener("close", () => {
      this.abortController?.abort();
      this.returnFocus?.focus();
      this.returnFocus = null;
    });
  }

  async open(area: string, publicId: string, trigger: HTMLElement): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.returnFocus = trigger;
    this.title.textContent = "Datensatz wird geladen";
    this.subtitle.textContent = "Nur-Lese-Detailansicht · serverseitig maskiert";
    this.content.replaceChildren(createEmptyState("Details werden geladen …"));
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    setRegionBusy(this.content, true);
    try {
      const detail = await getRecordDetail(
        area,
        publicId,
        this.abortController.signal
      );
      this.render(detail);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.title.textContent = "Datensatz nicht verfügbar";
      this.content.replaceChildren(
        createEmptyState(
          errorMessage(error, "Die Datensatzdetails konnten nicht geladen werden.")
        )
      );
    } finally {
      if (!this.abortController?.signal.aborted) {
        setRegionBusy(this.content, false);
      }
    }
  }

  private render(detail: DashboardRecordDetail): void {
    this.title.textContent = `${detail.label}: Datensatzdetails`;
    this.subtitle.textContent =
      "Nur-Lese-Ansicht · personenbezogene Werte serverseitig geschützt";

    const meta = document.createElement("section");
    meta.className = "record-meta";
    meta.setAttribute("aria-label", "Datensatzinformationen");
    meta.append(
      metaItem("Referenz", detail.recordRef),
      metaItem("Bereich", detail.label),
      metaItem("Erstmals gespeichert", formatDateTime(detail.firstSeenAt)),
      metaItem("Zuletzt gesehen", formatDateTime(detail.lastSeenAt)),
      metaItem("Zuletzt geändert", formatDateTime(detail.lastChangedAt))
    );
    const state = document.createElement("div");
    state.className = "record-meta-item";
    const stateLabel = document.createElement("span");
    stateLabel.textContent = "Änderungsstatus";
    state.append(
      stateLabel,
      createStatusBadge(
        detail.change === "created"
          ? "healthy"
          : detail.change === "updated"
            ? "warning"
            : "inactive",
        changeLabel(detail.change)
      )
    );
    meta.append(state);

    const fieldsSection = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = "Gespeicherte Felder";
    const fields = document.createElement("dl");
    fields.className = "record-fields";
    if (detail.fields.length === 0) {
      fieldsSection.append(
        heading,
        createEmptyState("Für diesen Datensatz sind keine Anzeigefelder gespeichert.")
      );
    } else {
      for (const field of detail.fields) {
        const group = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = field.label;
        if (field.masked) {
          const protectedLabel = document.createElement("small");
          protectedLabel.textContent = "geschützt";
          term.append(" ", protectedLabel);
        }
        const value = document.createElement("dd");
        value.textContent = field.value || "—";
        group.append(term, value);
        fields.append(group);
      }
      fieldsSection.append(heading, fields);
    }

    const historySection = document.createElement("section");
    const historyHeading = document.createElement("h3");
    historyHeading.textContent = "Änderungsverlauf";
    const history = document.createElement("ol");
    history.className = "change-history";
    if (detail.changeHistory.length === 0) {
      historySection.append(
        historyHeading,
        createEmptyState("Noch keine Änderungshistorie vorhanden.")
      );
    } else {
      for (const item of detail.changeHistory) {
        const row = document.createElement("li");
        const label = document.createElement("strong");
        label.textContent = changeLabel(item.changeKind ?? item.change);
        const time = document.createElement("time");
        time.dateTime = item.observedAt;
        time.textContent = formatDateTime(item.observedAt);
        row.append(label, time);
        history.append(row);
      }
      historySection.append(historyHeading, history);
    }

    this.content.replaceChildren(meta, fieldsSection, historySection);
  }
}

function metaItem(label: string, value: string): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "record-meta-item";
  const term = document.createElement("span");
  term.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  item.append(term, content);
  return item;
}
