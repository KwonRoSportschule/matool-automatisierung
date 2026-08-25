import type { DashboardState, RecordChange, RunStatus } from "./types";

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin"
});

const shortDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin"
});

const numberFormatter = new Intl.NumberFormat("de-DE");

export function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Noch nicht vorhanden";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Zeitpunkt unbekannt"
    : `${dateTimeFormatter.format(date)} Uhr`;
}

export function formatShortDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? value : shortDateFormatter.format(date);
}

export function formatEnvironment(value: string): string {
  return (
    {
      local: "Lokal",
      production: "Produktion",
      staging: "Staging",
      test: "Test"
    }[value] ?? value
  );
}

export function stateLabel(state: DashboardState): string {
  return (
    {
      critical: "Störung",
      healthy: "In Ordnung",
      inactive: "Deaktiviert",
      unknown: "Unklar",
      warning: "Warnung"
    }[state] ?? "Unklar"
  );
}

export function runStatusLabel(status: RunStatus | string | null): string {
  if (!status) {
    return "Noch kein Lauf";
  }
  return (
    {
      failed: "Fehlgeschlagen",
      info: "Information",
      partial_failed: "Teilweise fehlgeschlagen",
      running: "Läuft gerade",
      skipped: "Ausgelassen",
      succeeded: "Erfolgreich",
      warning: "Warnung"
    }[status] ?? status
  );
}

export function changeLabel(change: RecordChange | null | undefined): string {
  return (
    {
      created: "Neu",
      unchanged: "Unverändert",
      updated: "Geändert"
    }[change ?? ""] ?? "Unbekannt"
  );
}

export function executionLabel(value: string): string {
  return (
    {
      automatic: "Automatisch",
      automatic_and_manual: "Automatisch und manuell",
      manual: "Manuell",
      on_demand: "Bei Aufruf"
    }[value] ?? value
  );
}

export function functionStateLabel(value: string): string {
  return (
    {
      disabled: "Deaktiviert",
      enabled: "Aktiv",
      unavailable: "Nicht verfügbar"
    }[value] ?? value
  );
}

export function kindLabel(value: string): string {
  return (
    {
      automation: "Automatisierung",
      data: "Datenänderung",
      sync: "MATOOL-Abruf",
      zapier: "Zapier"
    }[value] ?? value
  );
}

export function formatDelay(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) {
    return "Nicht bestimmbar";
  }
  if (minutes <= 1) {
    return "Pünktlich";
  }
  return `${formatNumber(minutes)} Minuten Verzögerung`;
}

export function formatRangeLabel(days: number): string {
  return days === 1 ? "Letzte 24 Stunden" : `Letzte ${days} Tage`;
}

/**
 * Ein Datumsfeld meint den Tag in Berliner Zeit. Der Abstand zu UTC ist nicht
 * fest -- im Winter eine Stunde, im Sommer zwei. Fest verdrahtet laege der
 * Zeitfilter deshalb ein halbes Jahr lang um eine Stunde daneben.
 */
export function toIsoBoundary(value: string, endOfDay: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return "";
  }
  const wallClock = Date.parse(
    `${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
  );
  if (Number.isNaN(wallClock)) {
    return "";
  }
  return new Date(wallClock - berlinOffsetMs(wallClock)).toISOString();
}

const berlinPartFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Berlin",
  year: "numeric"
});

/** Abstand der Berliner Zeit zu UTC am gegebenen Zeitpunkt, in Millisekunden. */
function berlinOffsetMs(instant: number): number {
  const parts = berlinPartFormatter.formatToParts(new Date(instant));
  const part = (type: string): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    // Manche Laufzeiten melden Mitternacht als Stunde 24.
    part("hour") % 24,
    part("minute"),
    part("second")
  );
  return asIfUtc - instant;
}

export function setTimeText(
  element: HTMLElement,
  value: string | null | undefined
): void {
  element.textContent = formatDateTime(value);
  if (element instanceof HTMLTimeElement) {
    if (value) {
      element.dateTime = value;
    } else {
      element.removeAttribute("datetime");
    }
  }
}
