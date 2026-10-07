import { createStoredZip } from "./zip";

export const EXAM_PROGRAMS = [
  "panda-kids",
  "tiger-kids",
  "warrior-tigers"
] as const;

export const EXAM_LOCATIONS = [
  "Rosenheim",
  "Stephanskirchen",
  "Raubling"
] as const;

export type ExamProgram = (typeof EXAM_PROGRAMS)[number];
export type ExamLocation = (typeof EXAM_LOCATIONS)[number];

export interface ExamListRow {
  checkinsSinceLastExam: number | null;
  checkinsRequired: number;
  currentGraduation: string;
  /** Reihenfolge der Gruppe "Prüfung zum …" innerhalb der Gurtfolge. */
  examOrder: number;
  firstName: string;
  lastCheckinDate: string | null;
  lastExamDate: string | null;
  lastName: string;
  location: ExamLocation;
  missingCheckins: number | null;
  nextExam: string;
}

export interface ExamWorkbookInput {
  generatedAt: Date;
  /** Mitglieder, deren Stammdaten der Hub noch nicht gelesen hat. */
  pendingMembers: number;
  program: ExamProgram;
  rows: readonly ExamListRow[];
}

const encoder = new TextEncoder();
const HEADERS = [
  "PRÜFUNG ZUM",
  "NR.",
  "VORNAME",
  "NACHNAME",
  "AKTUELLE GRADUIERUNG",
  "NOCH FEHLENDE CHECK-INS",
  "LETZTE PRÜFUNG",
  "LETZTER CHECK-IN",
  "ANGESPROCHEN",
  "ERFASSTE CHECK-INS SEIT LETZTER PRÜFUNG",
  "NOTIZEN",
  "BRIEF ERHALTEN",
  "FITNESSTEST TEILGENOMMEN AM",
  "FITNESSTEST BESTANDEN AM",
  "PRÜFUNG TEILGENOMMEN AM",
  "PRÜFUNG BESTANDEN AM"
] as const;

export function examProgramLabel(program: ExamProgram): string {
  const labels: Record<ExamProgram, string> = {
    "panda-kids": "Panda-Kids",
    "tiger-kids": "Tiger-Kids",
    "warrior-tigers": "Warrior-Tigers"
  };
  return labels[program];
}

export function examWorkbookFilename(program: ExamProgram): string {
  return `${examProgramLabel(program).replaceAll("-", "_")}_Pruefungsliste.xlsx`;
}

export function buildExamWorkbook(input: ExamWorkbookInput): Uint8Array {
  const sheetEntries = EXAM_LOCATIONS.map((location, index) => ({
    data: encoder.encode(
      worksheetXml(
        input.rows.filter((row) => row.location === location),
        input,
        location
      )
    ),
    name: `xl/worksheets/sheet${index + 1}.xml`
  }));
  return createStoredZip(
    [
      { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml()) },
      { name: "_rels/.rels", data: encoder.encode(packageRelationsXml()) },
      { name: "docProps/app.xml", data: encoder.encode(appPropertiesXml()) },
      {
        name: "docProps/core.xml",
        data: encoder.encode(corePropertiesXml(input.generatedAt))
      },
      { name: "xl/workbook.xml", data: encoder.encode(workbookXml()) },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: encoder.encode(workbookRelationsXml())
      },
      { name: "xl/styles.xml", data: encoder.encode(stylesXml()) },
      ...sheetEntries
    ],
    input.generatedAt
  );
}

export function buildAllExamWorkbooksZip(
  workbooks: ReadonlyMap<ExamProgram, Uint8Array>,
  generatedAt: Date
): Uint8Array {
  return createStoredZip(
    EXAM_PROGRAMS.map((program) => {
      const data = workbooks.get(program);
      if (!data) {
        throw new Error("missing_exam_workbook");
      }
      return { data, name: examWorkbookFilename(program) };
    }),
    generatedAt
  );
}

function worksheetXml(
  sourceRows: readonly ExamListRow[],
  input: ExamWorkbookInput,
  location: ExamLocation
): string {
  const rows = [...sourceRows].sort(compareExamRows);
  const xmlRows: string[] = [];
  const merges: string[] = [];
  xmlRows.push(rowXml(1, [textCell("A1", `${examProgramLabel(input.program)} Prüfungsliste – ${location}`, 1)]));
  merges.push("A1:P1");
  const pending =
    input.pendingMembers > 0
      ? ` · ${input.pendingMembers} Mitglieder sind noch nicht eingelesen und fehlen eventuell.`
      : "";
  const note = `Erstellt am ${formatGermanDateTime(input.generatedAt)} aus dem stündlichen MATOOL-Abruf (je Kind höchstens wenige Stunden alt)${pending}`;
  xmlRows.push(rowXml(2, [textCell("A2", note, 2)]));
  merges.push("A2:P2");
  xmlRows.push(rowXml(4, HEADERS.map((header, index) => textCell(cellRef(index + 1, 4), header, 3))));

  let rowNumber = 5;
  let participantNumber = 1;
  let previousExam = "";
  for (const row of rows) {
    if (row.nextExam !== previousExam) {
      xmlRows.push(rowXml(rowNumber, [textCell(`A${rowNumber}`, row.nextExam, 5)]));
      merges.push(`A${rowNumber}:O${rowNumber}`);
      rowNumber += 1;
      previousExam = row.nextExam;
    }
    xmlRows.push(
      rowXml(rowNumber, [
        textCell(`A${rowNumber}`, row.nextExam, 0),
        numberCell(`B${rowNumber}`, participantNumber, 0),
        textCell(`C${rowNumber}`, row.firstName, 0),
        textCell(`D${rowNumber}`, row.lastName, 0),
        textCell(`E${rowNumber}`, row.currentGraduation, 0),
        row.missingCheckins === null
          ? textCell(`F${rowNumber}`, "Historie wird noch geladen", 6)
          : numberCell(`F${rowNumber}`, row.missingCheckins, 0),
        row.lastExamDate
          ? dateCell(`G${rowNumber}`, row.lastExamDate)
          : textCell(`G${rowNumber}`, "Nicht vorhanden", 6),
        row.lastCheckinDate
          ? dateCell(`H${rowNumber}`, row.lastCheckinDate)
          : textCell(`H${rowNumber}`, "Nicht vorhanden", 6),
        blankCell(`I${rowNumber}`),
        row.checkinsSinceLastExam === null
          ? textCell(`J${rowNumber}`, "Historie wird noch geladen", 6)
          : numberCell(`J${rowNumber}`, row.checkinsSinceLastExam, 0),
        blankCell(`K${rowNumber}`),
        blankCell(`L${rowNumber}`),
        blankCell(`M${rowNumber}`),
        blankCell(`N${rowNumber}`),
        blankCell(`O${rowNumber}`),
        blankCell(`P${rowNumber}`)
      ])
    );
    participantNumber += 1;
    rowNumber += 1;
  }
  xmlRows.push(
    rowXml(rowNumber, [
      textCell(`A${rowNumber}`, "Summe", 7),
      numberCell(`B${rowNumber}`, rows.length, 7)
    ])
  );
  const lastRow = rowNumber;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:P${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="7" customWidth="1"/>
    <col min="3" max="4" width="18" customWidth="1"/><col min="5" max="5" width="24" customWidth="1"/>
    <col min="6" max="6" width="24" customWidth="1"/><col min="7" max="8" width="18" customWidth="1"/>
    <col min="9" max="9" width="18" customWidth="1"/><col min="10" max="10" width="28" customWidth="1"/>
    <col min="11" max="11" width="34" customWidth="1"/>
    <col min="12" max="16" width="23" customWidth="1"/>
  </cols>
  <sheetData>${xmlRows.join("")}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function compareExamRows(left: ExamListRow, right: ExamListRow): number {
  if (left.examOrder !== right.examOrder) {
    return left.examOrder - right.examOrder;
  }
  return `${left.lastName}\u0000${left.firstName}`.localeCompare(
    `${right.lastName}\u0000${right.firstName}`,
    "de"
  );
}

function rowXml(index: number, cells: readonly string[]): string {
  return `<row r="${index}">${cells.join("")}</row>`;
}

function textCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number, style: number): string {
  return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
}

function blankCell(reference: string): string {
  return `<c r="${reference}"/>`;
}

function dateCell(reference: string, isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!match?.[1] || !match[2] || !match[3]) {
    return textCell(reference, isoDate, 0);
  }
  const serial =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) /
      86_400_000 +
    25_569;
  return `<c r="${reference}" s="4"><v>${serial}</v></c>`;
}

function cellRef(column: number, row: number): string {
  let value = column;
  let letters = "";
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return `${letters}${row}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatGermanDateTime(value: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin"
  }).format(value);
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${EXAM_LOCATIONS.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function packageRelationsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets>${EXAM_LOCATIONS.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;
}

function workbookRelationsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${EXAM_LOCATIONS.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="0"/>
  <fonts count="5">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF20342A"/><name val="Arial"/></font>
    <font><i/><sz val="9"/><color rgb="FF5E6E65"/><name val="Arial"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF20342A"/><name val="Arial"/></font>
  </fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2E483B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEADF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF4CC"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFD7DFD9"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function appPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MATOOL Middleware Hub</Application></Properties>`;
}

function corePropertiesXml(createdAt: Date): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>KwonRo Sportschule</dc:creator><dc:title>Automatische Prüfungsliste</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt.toISOString()}</dcterms:created></cp:coreProperties>`;
}
