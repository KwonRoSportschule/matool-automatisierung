import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath =
  "outputs/zapier-trigger-analyse-20260825/zapier-trigger-matrix.xlsx";
const previewDir = "outputs/zapier-trigger-analyse-20260825/previews-before";

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

console.log(
  (
    await workbook.inspect({
      kind: "workbook,sheet,table",
      maxChars: 6000,
      tableMaxRows: 6,
      tableMaxCols: 12,
      tableMaxCellChars: 80
    })
  ).ndjson
);
console.log(
  (
    await workbook.inspect({
      kind: "computedStyle",
      sheetId: "Trigger-Matrix",
      range: "A1:L12",
      maxChars: 3000
    })
  ).ndjson
);

await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range] of [
  ["Übersicht", "A1:H18"],
  ["Trigger-Matrix", "A1:L27"],
  ["Datenbasis", "A1:D12"],
  ["Offene Punkte", "A1:E11"]
]) {
  const image = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(
    `${previewDir}/${sheetName}.png`,
    new Uint8Array(await image.arrayBuffer())
  );
}
