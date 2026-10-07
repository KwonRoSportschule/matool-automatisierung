import { AppError } from "../core/app-error";
import { MatoolClient } from "../matool/client";
import type { Env } from "../worker/env";
import { loadExamListDataset } from "./data";
import {
  buildAllExamWorkbooksZip,
  buildExamWorkbook,
  EXAM_PROGRAMS,
  examWorkbookFilename,
  type ExamProgram
} from "./xlsx";

type DownloadSelection = ExamProgram | "all";

export async function createExamListDownload(
  request: Request,
  env: Env
): Promise<Response> {
  const selection = await parseSelection(request);
  if (!env.MATOOL_EMAIL || !env.MATOOL_PASSWORD) {
    throw new AppError(
      "matool_not_configured",
      409,
      "Die MATOOL-Verbindung ist noch nicht eingerichtet."
    );
  }
  if (env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
    throw new AppError(
      "matool_runs_not_confirmed",
      409,
      "Read-only-Echtdatenläufe sind noch nicht freigegeben."
    );
  }

  const generatedAt = new Date();
  const client = new MatoolClient(env.MATOOL_BASE_URL);
  try {
    const liveRoster = await client.extractSafeArea(
      { email: env.MATOOL_EMAIL, password: env.MATOOL_PASSWORD },
      "schueler"
    );
    const dataset = await loadExamListDataset(env, liveRoster.records);
    assertLocationsResolved(dataset.unresolvedLocations, selection);
    if (selection === "all") {
      const workbooks = new Map(
        EXAM_PROGRAMS.map((program) => [
          program,
          buildExamWorkbook({
            generatedAt,
            incompleteCheckinHistory: true,
            program,
            rows: dataset.rows.get(program) ?? []
          })
        ])
      );
      return downloadResponse(
        buildAllExamWorkbooksZip(workbooks, generatedAt),
        "Kinder_Pruefungslisten.zip",
        "application/zip"
      );
    }
    return downloadResponse(
      buildExamWorkbook({
        generatedAt,
        incompleteCheckinHistory: true,
        program: selection,
        rows: dataset.rows.get(selection) ?? []
      }),
      examWorkbookFilename(selection),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  } finally {
    client.clearSession();
  }
}

function assertLocationsResolved(
  unresolved: ReadonlyMap<ExamProgram, number>,
  selection: DownloadSelection
): void {
  const programs: readonly ExamProgram[] =
    selection === "all" ? EXAM_PROGRAMS : [selection];
  const count = programs.reduce<number>(
    (sum, program) => sum + (unresolved.get(program) ?? 0),
    0
  );
  if (count > 0) {
    throw new AppError(
      "exam_list_location_unresolved",
      409,
      `Bei ${count} Kindern ist der Standort in den gespeicherten MATOOL-Daten nicht eindeutig. Die Liste wird vorsorglich nicht erstellt.`
    );
  }
}

async function parseSelection(request: Request): Promise<DownloadSelection> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw invalidRequest();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest();
  }
  const keys = Object.keys(body);
  const selection = (body as Record<string, unknown>).program;
  if (
    keys.length !== 1 ||
    typeof selection !== "string" ||
    (selection !== "all" && !EXAM_PROGRAMS.includes(selection as ExamProgram))
  ) {
    throw invalidRequest();
  }
  return selection as DownloadSelection;
}

function downloadResponse(
  bytes: Uint8Array,
  filename: string,
  contentType: string
): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function invalidRequest(): AppError {
  return new AppError(
    "invalid_exam_list_request",
    400,
    "Bitte eine gültige Prüfungslisten-Datei auswählen."
  );
}
