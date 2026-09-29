import { getSyncStatus, isAbortError } from "./api";
import { byId } from "./dom";
import type { ManualSyncJob, SyncProgress, SyncStatusResponse } from "./types";

/** Abfragetakt waehrend eines Abrufs bzw. in Ruhe. */
const POLL_ACTIVE_MS = 10_000;
const POLL_IDLE_MS = 60_000;

const elements = {
  card: byId("sync-progress"),
  eyebrow: byId("sync-progress-eyebrow"),
  title: byId("sync-progress-title"),
  percent: byId("sync-progress-percent"),
  bar: byId("sync-progress-bar"),
  fill: byId("sync-progress-fill"),
  meta: byId("sync-progress-meta"),
  areas: byId("sync-progress-areas")
};

const uhrzeit = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin"
});

function minuten(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return `${min} Min.`;
}

const OFFEN: ReadonlySet<ManualSyncJob["status"]> = new Set(["requested", "waiting", "running"]);

export function isManualSyncOpen(manual: ManualSyncJob | null): boolean {
  return manual !== null && OFFEN.has(manual.status);
}

/**
 * Zeigt den laufenden Abruf. Ohne Lauf, aber mit wartendem manuellem
 * Auftrag, erscheint dieser; sonst bleibt die Karte verborgen.
 */
export function renderSyncProgress(status: SyncStatusResponse): void {
  const { progress, manual } = status;
  if (progress) {
    renderLauf(progress, manual);
    return;
  }
  if (isManualSyncOpen(manual) && manual) {
    renderWartend(manual);
    return;
  }
  elements.card.hidden = true;
}

function renderLauf(progress: SyncProgress, manual: ManualSyncJob | null): void {
  elements.card.hidden = false;
  elements.eyebrow.textContent =
    progress.trigger === "scheduled" ? "Stündlicher Abruf läuft" : "Manueller Abruf läuft";
  elements.title.textContent = progress.current
    ? `${progress.current.label} wird gelesen`
    : "Abruf wird abgeschlossen";
  setPercent(progress.percent);
  const warteHinweis =
    progress.trigger === "scheduled" && isManualSyncOpen(manual)
      ? " · Dein manueller Abruf startet direkt danach."
      : "";
  elements.meta.textContent =
    `Gestartet ${uhrzeit.format(new Date(progress.startedAt))} Uhr · ` +
    `voraussichtlich fertig gegen ${uhrzeit.format(new Date(progress.estimatedFinishAt))} Uhr ` +
    `(noch etwa ${minuten(progress.remainingMs)})${warteHinweis}`;
  elements.areas.replaceChildren(
    ...progress.areas.map((area) => {
      const item = document.createElement("li");
      item.dataset.state = area.state;
      const head = document.createElement("div");
      head.className = "sync-progress-area-head";
      const name = document.createElement("strong");
      name.textContent = area.label;
      const zustand = document.createElement("span");
      zustand.textContent =
        area.state === "done"
          ? "fertig"
          : area.state === "failed"
            ? "Fehler"
            : area.state === "running"
              ? `läuft · ca. ${minuten(area.estimateMs)}`
              : "wartet";
      if (area.errorCode) {
        zustand.title = area.errorCode;
      }
      head.append(name, zustand);
      const bar = document.createElement("div");
      bar.className = "sync-progress-area-bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, area.fraction)) * 100)}%`;
      bar.append(fill);
      item.append(head, bar);
      return item;
    })
  );
}

function renderWartend(manual: ManualSyncJob): void {
  elements.card.hidden = false;
  elements.eyebrow.textContent = "Manueller Abruf angefordert";
  elements.title.textContent =
    manual.status === "waiting"
      ? "Wartet auf das Ende des laufenden Abrufs"
      : manual.status === "running"
        ? "Manueller Abruf startet"
        : "Manueller Abruf wird gestartet";
  setPercent(0);
  elements.meta.textContent =
    `Angefordert ${uhrzeit.format(new Date(manual.requestedAt))} Uhr · ` +
    "läuft unabhängig vom Browser weiter, die Seite darf geschlossen werden.";
  elements.areas.replaceChildren();
}

function setPercent(percent: number): void {
  const wert = Math.max(0, Math.min(100, Math.round(percent)));
  elements.percent.textContent = `${wert} %`;
  elements.fill.style.width = `${wert}%`;
  elements.bar.setAttribute("aria-valuenow", String(wert));
}

/**
 * Fragt den Stand regelmaessig ab: alle 10 Sekunden, solange etwas laeuft
 * oder angefordert ist, sonst jede Minute. Endet ein Abruf, wird
 * `onFinished` gerufen (Dashboard neu laden).
 */
export class SyncProgressPoller {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #controller: AbortController | null = null;
  #aktiv = false;
  #letzter: SyncStatusResponse | null = null;

  constructor(
    private readonly onStatus: (status: SyncStatusResponse) => void,
    private readonly onFinished: () => void
  ) {}

  get last(): SyncStatusResponse | null {
    return this.#letzter;
  }

  /** Sofort abfragen (z. B. nach dem Klick auf den Knopf). */
  now(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    void this.#tick();
  }

  /** Einen bereits bekannten Stand uebernehmen und weiter abfragen. */
  accept(status: SyncStatusResponse): void {
    this.#anwenden(status);
    this.#planen();
  }

  async #tick(): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    try {
      this.#anwenden(await getSyncStatus(controller.signal));
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      // Ein Fehler beim Abfragen blendet nichts ein; naechster Versuch folgt.
    }
    this.#planen();
  }

  #anwenden(status: SyncStatusResponse): void {
    this.#letzter = status;
    const aktiv = status.progress !== null || isManualSyncOpen(status.manual);
    renderSyncProgress(status);
    this.onStatus(status);
    if (this.#aktiv && !aktiv) {
      this.onFinished();
    }
    this.#aktiv = aktiv;
  }

  #planen(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(
      () => void this.#tick(),
      this.#aktiv ? POLL_ACTIVE_MS : POLL_IDLE_MS
    );
  }
}
