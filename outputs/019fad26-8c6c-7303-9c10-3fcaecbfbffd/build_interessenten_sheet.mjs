import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const BASE_URL = "https://matool-middleware-staging.soft-hill-4630.workers.dev";
const OUTPUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(OUTPUT_DIR, "MATOOL-Interessenten-Automatisierung.xlsx");
const PREVIEW_FILE = path.join(OUTPUT_DIR, "MATOOL-Interessenten-Vorschau.png");

async function fetchArea(area) {
  const first = await fetchPage(area, 1);
  const records = [...first.records];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await fetchPage(area, page);
    records.push(...next.records);
  }
  return { ...first, records };
}

async function fetchPage(area, page) {
  const url = new URL("/api/admin/v1/dashboard/records", BASE_URL);
  url.searchParams.set("area", area);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort", "recordRef");
  url.searchParams.set("direction", "asc");
  url.searchParams.set("change", "all");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Dashboard-Abruf ${area} fehlgeschlagen (${response.status}).`);
  }
  const payload = await response.json();
  if (payload.masked !== false || !Array.isArray(payload.records) || !Array.isArray(payload.columns)) {
    throw new Error(`Dashboard-Antwort ${area} ist nicht als unmaskierter Datensatz nutzbar.`);
  }
  return payload;
}

function excelColumn(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.startsWith("=") ? `'${text}` : text;
}

function timestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? safeString(value) : parsed;
}

function styleDataSheet(sheet, rowCount, headers) {
  const columnCount = headers.length;
  const lastColumn = excelColumn(columnCount - 1);
  const header = sheet.getRange(`A1:${lastColumn}1`);
  header.format = {
    fill: "#E5E7EB",
    font: { bold: true, color: "#111827" },
    borders: { preset: "all", style: "thin", color: "#C7CDD4" },
    wrapText: true,
    verticalAlignment: "center"
  };
  header.format.rowHeight = 34;
  if (rowCount > 0) {
    const body = sheet.getRange(`A2:${lastColumn}${rowCount + 1}`);
    body.format = {
      borders: { preset: "all", style: "thin", color: "#E5E7EB" },
      verticalAlignment: "top"
    };
    body.format.rowHeight = 22;
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(2);
  for (let column = 0; column < columnCount; column += 1) {
    const range = sheet.getRangeByIndexes(0, column, rowCount + 1, 1);
    range.format.columnWidth = Math.min(28, Math.max(12, String(headers[column] ?? "").length + 2));
  }
}

const [listData, detailData] = await Promise.all([
  fetchArea("interessenten"),
  fetchArea("interessenten_details")
]);

const detailKeys = detailData.columns.map((column) => column.key);
const detailLabels = new Map(detailData.columns.map((column) => [column.key, column.label]));
const listOnlyColumns = listData.columns.filter((column) => !detailKeys.includes(column.key));

const technicalHeaders = [
  "MATOOL ID",
  "Detailstatus",
  "Änderungsart",
  "Aktuell",
  "Erstmals gesehen",
  "Zuletzt geändert",
  "Zuletzt gesehen"
];
const detailHeaders = detailKeys.map((key) => detailLabels.get(key) || key);
const listOnlyHeaders = listOnlyColumns.map((column) => `Liste: ${column.label}`);
const allHeaders = [...technicalHeaders, ...detailHeaders, ...listOnlyHeaders];

const allRows = listData.records.map((listRecord) => {
  const values = listRecord.values ?? {};
  const technical = [
    safeString(listRecord.recordRef),
    "Details werden schrittweise in 'Zapier Detail-Verlauf' ergänzt",
    safeString(listRecord.change),
    listRecord.isCurrent ?? true,
    timestamp(listRecord.firstSeenAt),
    timestamp(listRecord.lastChangedAt),
    timestamp(listRecord.lastSeenAt)
  ];
  const details = detailKeys.map((key) => safeString(values[key]));
  const listOnly = listOnlyColumns.map((column) => safeString(listRecord.values?.[column.key]));
  return [...technical, ...details, ...listOnly];
});

const logHeaders = [
  "Zapier Datensatz-ID",
  "MATOOL ID",
  "Inhalts-Hash",
  "Erstmals gesehen",
  "Zuletzt geändert",
  "Zuletzt gesehen",
  "Neu",
  ...detailHeaders
];
const logRows = detailData.records.map((record) => [
  safeString(record.publicId),
  safeString(record.recordRef),
  "",
  timestamp(record.firstSeenAt),
  timestamp(record.lastChangedAt),
  timestamp(record.lastSeenAt),
  record.change === "new",
  ...detailKeys.map((key) => safeString(record.values?.[key]))
]);

const workbook = Workbook.create();
const info = workbook.worksheets.add("Datenstatus");
const all = workbook.worksheets.add("Alle Interessenten");
const log = workbook.worksheets.add("Zapier Detail-Verlauf");

info.getRange("A1:D1").merge();
info.getRange("A1").values = [["MATOOL → Zapier → Google Sheets"]];
info.getRange("A1:D1").format = {
  fill: "#E5E7EB",
  font: { bold: true, color: "#111827", size: 14 },
  borders: { preset: "all", style: "thin", color: "#C7CDD4" }
};
info.getRange("A3:B9").values = [
  ["Stand", new Date()],
  ["Interessenten insgesamt", listData.total],
  ["Detaildatensätze im Hub", detailData.total],
  ["Details noch nicht im Hub", Math.max(0, listData.total - detailData.total)],
  ["Automatisierung", "Neue oder geänderte Detaildatensätze werden von Zapier angehängt."],
  ["Kontaktaufnahme", "Keine – diese Datei dient ausschließlich der internen Datenübertragung."],
  ["Quelle", BASE_URL]
];
info.getRange("A3:A9").format = { fill: "#F3F4F6", font: { bold: true }, borders: { preset: "all", style: "thin", color: "#D1D5DB" } };
info.getRange("B3:B9").format = { borders: { preset: "all", style: "thin", color: "#D1D5DB" }, wrapText: true };
info.getRange("B3").setNumberFormat("yyyy-mm-dd hh:mm");
info.freezePanes.freezeRows(1);
info.getRange("A:D").format.columnWidth = 26;
info.getRange("B:B").format.columnWidth = 58;

all.getRangeByIndexes(0, 0, allRows.length + 1, allHeaders.length).values = [allHeaders, ...allRows];
styleDataSheet(all, allRows.length, allHeaders);

log.getRangeByIndexes(0, 0, logRows.length + 1, logHeaders.length).values = [logHeaders, ...logRows];
styleDataSheet(log, logRows.length, logHeaders);

const preview = await workbook.render({ sheetName: "Datenstatus", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(PREVIEW_FILE, new Uint8Array(await preview.arrayBuffer()));

const errorPattern = /^(?:#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A)$/u;
const errorMatches = [...allRows, ...logRows].flat().filter((value) =>
  errorPattern.test(String(value ?? ""))
).length;
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(OUTPUT_FILE);

console.log(JSON.stringify({
  outputFile: OUTPUT_FILE,
  previewFile: PREVIEW_FILE,
  prospectCount: listData.total,
  detailCount: detailData.total,
  missingDetailCount: Math.max(0, listData.total - detailData.total),
  sheetNames: ["Datenstatus", "Alle Interessenten", "Zapier Detail-Verlauf"],
  allRows: allRows.length,
  allColumns: allHeaders.length,
  logRows: logRows.length,
  logColumns: logHeaders.length,
  errorMatches
}));
