import { beitraegeQuery, getBeitraege, isAbortError } from "./api";
import {
  byId,
  createEmptyState,
  createStatusBadge,
  errorMessage,
  setRegionBusy
} from "./dom";
import { formatDateTime, formatNumber } from "./format";
import type {
  BeitraegeResponse,
  BeitragsPosition,
  NichtEingerechnetGrund,
  NichtEingerechnetePosition
} from "./types";

const euro = new Intl.NumberFormat("de-DE", { currency: "EUR", style: "currency" });

const GRUND_LABELS: Readonly<Record<NichtEingerechnetGrund, string>> = {
  beitrag_unlesbar: "Beitrag nicht lesbar",
  stammdaten_fehlen: "Stammdaten fehlen noch",
  stillgelegt: "Stillgelegt",
  zahlungsperiode_unbekannt: "Zahlungsperiode unbekannt"
};

const FELD_LABELS: Readonly<Record<string, string>> = {
  kundenart: "Kundenart",
  vertrag: "Vertrag",
  zahlart: "Zahlart",
  zahlungsperiode: "Zahlungsperiode"
};

/**
 * Beitragsuebersicht im Dashboard: dieselbe Berechnung, die Zapier abruft,
 * zum Pruefen vor dem ersten Versand und zum manuellen XML-Download.
 */
export class BeitraegeView {
  private readonly ausschlussBody = byId<HTMLTableSectionElement>("beitraege-ausschluss-body");
  private readonly ausschlussCount = byId("beitraege-ausschluss-count");
  private readonly body = byId<HTMLTableSectionElement>("beitraege-body");
  private readonly download = byId<HTMLAnchorElement>("beitraege-download");
  private readonly feldwerte = byId("beitraege-feldwerte");
  private readonly hinweis = byId("beitraege-hinweis");
  private readonly loadButton = byId<HTMLButtonElement>("beitraege-load");
  private readonly message = byId("beitraege-message");
  private readonly metrics = byId("beitraege-metrics");
  private readonly region = byId("beitraege-region");
  private readonly regeln = byId("beitraege-regeln");
  private readonly stichtag = byId<HTMLInputElement>("beitraege-stichtag");
  private abortController: AbortController | null = null;

  constructor() {
    this.loadButton.addEventListener("click", () => {
      void this.load();
    });
    this.stichtag.addEventListener("change", () => {
      this.updateDownloadLink();
      void this.load();
    });
    this.updateDownloadLink();
  }

  async load(): Promise<void> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    setRegionBusy(this.region, true);
    this.message.textContent = "Beitragsübersicht wird berechnet …";
    try {
      this.render(await getBeitraege(this.stichtag.value, controller.signal));
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      this.metrics.replaceChildren();
      this.hinweis.hidden = true;
      this.body.replaceChildren(
        emptyRow(7, errorMessage(error, "Die Beitragsübersicht konnte nicht berechnet werden."))
      );
      this.message.textContent = "Beitragsübersicht momentan nicht verfügbar.";
    } finally {
      if (!controller.signal.aborted) {
        setRegionBusy(this.region, false);
      }
    }
  }

  private updateDownloadLink(): void {
    this.download.href = `/api/admin/v1/beitraege.xml${beitraegeQuery(this.stichtag.value)}`;
  }

  private render(response: BeitraegeResponse): void {
    const { uebersicht } = response;
    const z = uebersicht.zusammenfassung;

    this.metrics.replaceChildren(
      metric("Monatssumme", euro.format(z.monatssummeCent / 100), `Stichtag ${formatStichtag(uebersicht.stichtag)}`),
      metric("Eingerechnet", formatNumber(z.eingerechnet), `${formatNumber(z.mitBeitrag)} mit, ${formatNumber(z.ohneBeitrag)} ohne Beitrag`),
      metric("Stillgelegt", formatNumber(z.stillgelegt), "nicht in der Summe"),
      metric("Stammdaten fehlen", formatNumber(z.stammdatenFehlen), "werden stündlich nachgeladen"),
      metric("Nicht berechenbar", formatNumber(z.nichtBerechenbar), "Wert in MATOOL prüfen"),
      metric("Mitglieder gesamt", formatNumber(z.mitgliederGesamt), "laut Mitgliederliste"),
      metric(
        "Datenstand",
        z.datenstandAeltester ? formatShortDateTime(z.datenstandAeltester).datum : "–",
        z.datenstandAeltester
          ? `ältester Stammdatenabruf, ${formatShortDateTime(z.datenstandAeltester).uhrzeit} Uhr`
          : "noch keine Stammdaten"
      )
    );

    this.hinweis.replaceChildren(
      createStatusBadge(
        z.vollstaendig ? "healthy" : "warning",
        z.vollstaendig ? "Vollständig" : "Unvollständig"
      ),
      document.createTextNode(
        z.vollstaendig
          ? " Jedes nicht stillgelegte Mitglied ist eingerechnet. Zapier würde diese Übersicht versenden."
          : z.mitgliederGesamt === 0
            ? " Die Mitgliederliste wurde noch nicht aus MATOOL gelesen."
            : " Mindestens ein aktives Mitglied fehlt in der Summe (siehe „Nicht eingerechnet“). Zapier bricht mit der empfohlenen Einstellung ab, statt eine zu niedrige Summe zu senden."
      )
    );
    this.hinweis.hidden = false;
    this.hinweis.dataset.state = z.vollstaendig ? "healthy" : "warning";

    this.body.replaceChildren(
      ...(uebersicht.positionen.length > 0
        ? uebersicht.positionen.map(positionRow)
        : [emptyRow(7, "Keine eingerechneten Mitglieder.")])
    );
    this.ausschlussCount.textContent = formatNumber(uebersicht.nichtEingerechnet.length);
    this.ausschlussBody.replaceChildren(
      ...(uebersicht.nichtEingerechnet.length > 0
        ? uebersicht.nichtEingerechnet.map(ausschlussRow)
        : [emptyRow(4, "Alle Mitglieder sind eingerechnet.")])
    );

    const regeln = uebersicht.regeln;
    this.regeln.textContent =
      `Betrag: ${regeln.betragsBezug === "monat" ? "MATOOL-Beitrag ist bereits der Monatsbetrag" : "MATOOL-Beitrag gilt je Zahlungsperiode und wird auf einen Monat umgerechnet"}. ` +
      `Stillgelegt, wenn ${regeln.stilllegungFelder.join(" oder ")} eines dieser Muster enthält: ${regeln.stilllegungMuster.join(", ")}. ` +
      "Anpassbar über die Worker-Variablen BEITRAEGE_BETRAGSBEZUG, BEITRAEGE_STILLLEGUNG_FELDER und BEITRAEGE_STILLLEGUNG_MUSTER.";
    this.feldwerte.replaceChildren(
      ...response.feldwerte.map((verteilung) => {
        const block = document.createElement("div");
        block.className = "feldwerte-block";
        const title = document.createElement("h3");
        title.textContent = FELD_LABELS[verteilung.feld] ?? verteilung.feld;
        const list = document.createElement("ul");
        for (const eintrag of verteilung.werte.slice(0, 25)) {
          const item = document.createElement("li");
          const wert = document.createElement("span");
          wert.textContent = eintrag.wert;
          const anzahl = document.createElement("strong");
          anzahl.textContent = formatNumber(eintrag.anzahl);
          item.append(wert, anzahl);
          list.append(item);
        }
        if (verteilung.werte.length > 25) {
          const item = document.createElement("li");
          item.textContent = `… ${formatNumber(verteilung.werte.length - 25)} weitere Werte`;
          list.append(item);
        }
        block.append(title, list);
        return block;
      })
    );

    this.message.textContent = `Berechnet ${formatDateTime(response.generatedAt)}${response.masked ? " · Namen serverseitig maskiert" : ""}.`;
  }
}

const datum = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
  year: "numeric"
});
const uhrzeit = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin"
});

function formatShortDateTime(value: string): { datum: string; uhrzeit: string } {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? { datum: value, uhrzeit: "–" }
    : { datum: datum.format(date), uhrzeit: uhrzeit.format(date) };
}

function formatStichtag(value: string): string {
  const [jahr, monat, tag] = value.split("-");
  return jahr && monat && tag ? `${tag}.${monat}.${jahr}` : value;
}

function metric(label: string, value: string, hint: string): HTMLElement {
  const card = document.createElement("article");
  card.className = "metric-card";
  const title = document.createElement("span");
  title.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  const small = document.createElement("small");
  small.textContent = hint;
  card.append(title, strong, small);
  return card;
}

function personName(entry: { nachname: string; vorname: string }): string {
  return [entry.nachname, entry.vorname].filter((teil) => teil.length > 0).join(", ") || "—";
}

function positionRow(position: BeitragsPosition): HTMLTableRowElement {
  const row = document.createElement("tr");
  appendCell(row, personName(position));
  appendCell(row, position.mitgliedsnummer || "—");
  appendCell(row, position.vertrag || "—");
  appendCell(row, position.kundenart || "—");
  appendCell(row, position.zahlungsperiode || "—");
  appendCell(row, euro.format(position.beitragCent / 100), "numeric");
  appendCell(row, euro.format(position.monatsbeitragCent / 100), "numeric");
  return row;
}

function ausschlussRow(eintrag: NichtEingerechnetePosition): HTMLTableRowElement {
  const row = document.createElement("tr");
  appendCell(row, personName(eintrag));
  appendCell(row, eintrag.mitgliedsnummer || "—");
  const grund = document.createElement("td");
  grund.append(
    createStatusBadge(
      eintrag.grund === "stillgelegt" ? "inactive" : "warning",
      GRUND_LABELS[eintrag.grund] ?? eintrag.grund
    )
  );
  row.append(grund);
  appendCell(row, eintrag.detail || "—");
  return row;
}

function appendCell(row: HTMLTableRowElement, text: string, className?: string): void {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
}

function emptyRow(columns: number, message: string): HTMLTableRowElement {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columns;
  cell.append(createEmptyState(message));
  row.append(cell);
  return row;
}
