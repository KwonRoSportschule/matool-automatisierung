import { formatNumber, formatShortDate } from "./format";
import type { ChartPoint } from "./types";

interface ChartSeries {
  className: string;
  key: "changed" | "failed" | "new" | "successful";
  label: string;
}

export function renderRunChart(
  container: HTMLElement,
  points: readonly ChartPoint[]
): void {
  renderBarChart(container, aggregatePoints(points), [
    { className: "bar-success", key: "successful", label: "Erfolgreich" },
    { className: "bar-error", key: "failed", label: "Fehlgeschlagen" }
  ], "Erfolgreiche und fehlgeschlagene automatische Läufe");
}

export function renderChangeChart(
  container: HTMLElement,
  points: readonly ChartPoint[]
): void {
  renderBarChart(container, aggregatePoints(points), [
    { className: "bar-new", key: "new", label: "Neu" },
    { className: "bar-changed", key: "changed", label: "Geändert" }
  ], "Neue und geänderte Datensätze");
}

function renderBarChart(
  container: HTMLElement,
  points: readonly ChartPoint[],
  series: readonly ChartSeries[],
  description: string
): void {
  if (points.length === 0 || points.every((point) => totalFor(point, series) === 0)) {
    const empty = document.createElement("div");
    empty.className = "chart-empty empty-state";
    empty.textContent = "Für diesen Zeitraum liegen noch keine Werte vor.";
    container.replaceChildren(empty);
    return;
  }

  const maximum = Math.max(
    1,
    ...points.flatMap((point) => series.map((entry) => point[entry.key]))
  );
  const figure = document.createElement("figure");
  figure.className = "bar-chart";
  figure.setAttribute("role", "img");
  figure.setAttribute("aria-label", description);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  for (const entry of series) {
    const item = document.createElement("span");
    const marker = document.createElement("i");
    marker.className = `legend-marker ${entry.className}`;
    marker.setAttribute("aria-hidden", "true");
    item.append(marker, entry.label);
    legend.append(item);
  }

  const plotScroll = document.createElement("div");
  plotScroll.className = "chart-scroll";
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  plot.style.setProperty("--chart-columns", String(points.length));

  for (const point of points) {
    const group = document.createElement("div");
    group.className = "chart-group";
    group.setAttribute(
      "aria-label",
      `${chartLabel(point.label)}: ${series
        .map((entry) => `${entry.label} ${formatNumber(point[entry.key])}`)
        .join(", ")}`
    );

    const bars = document.createElement("div");
    bars.className = "chart-bars";
    for (const entry of series) {
      const bar = document.createElement("span");
      bar.className = `chart-bar ${entry.className}`;
      bar.style.setProperty(
        "--bar-height",
        `${Math.max(point[entry.key] > 0 ? 4 : 0, (point[entry.key] / maximum) * 100)}%`
      );
      const value = document.createElement("span");
      value.className = "chart-value";
      value.textContent = point[entry.key] > 0 ? formatNumber(point[entry.key]) : "";
      bar.append(value);
      bars.append(bar);
    }
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = chartLabel(point.label);
    group.append(bars, label);
    plot.append(group);
  }
  plotScroll.append(plot);

  const dataDetails = document.createElement("details");
  dataDetails.className = "chart-data";
  const summary = document.createElement("summary");
  summary.textContent = "Werte als Tabelle anzeigen";
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap compact-table";
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = description;
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  appendHeader(headRow, "Zeitraum");
  for (const entry of series) {
    appendHeader(headRow, entry.label);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const point of points) {
    const row = document.createElement("tr");
    appendCell(row, chartLabel(point.label));
    for (const entry of series) {
      appendCell(row, formatNumber(point[entry.key]));
    }
    body.append(row);
  }
  table.append(caption, head, body);
  tableWrap.append(table);
  dataDetails.append(summary, tableWrap);

  figure.append(legend, plotScroll, dataDetails);
  container.replaceChildren(figure);
}

function aggregatePoints(points: readonly ChartPoint[]): ChartPoint[] {
  if (points.length <= 31) {
    return [...points];
  }
  const size = Math.ceil(points.length / 18);
  const aggregated: ChartPoint[] = [];
  for (let index = 0; index < points.length; index += size) {
    const group = points.slice(index, index + size);
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) {
      continue;
    }
    aggregated.push({
      changed: sum(group, "changed"),
      failed: sum(group, "failed"),
      label:
        first.label === last.label
          ? first.label
          : `${first.label}/${last.label}`,
      new: sum(group, "new"),
      successful: sum(group, "successful")
    });
  }
  return aggregated;
}

function sum(
  points: readonly ChartPoint[],
  key: ChartSeries["key"]
): number {
  return points.reduce((total, point) => total + point[key], 0);
}

function totalFor(
  point: ChartPoint,
  series: readonly ChartSeries[]
): number {
  return series.reduce((total, entry) => total + point[entry.key], 0);
}

function chartLabel(value: string): string {
  const [first, last] = value.split("/");
  if (!first) {
    return value;
  }
  return last
    ? `${formatShortDate(first)}–${formatShortDate(last)}`
    : formatShortDate(first);
}

function appendHeader(row: HTMLTableRowElement, value: string): void {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.textContent = value;
  row.append(cell);
}

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
}
