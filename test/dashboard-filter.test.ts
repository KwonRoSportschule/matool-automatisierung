import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import dashboardHtml from "../web/index.html?raw";
import {
  parseDashboardActivityQuery,
  parseDashboardRecordQuery
} from "../src/worker/dashboard-query";
import type { Env } from "../src/worker/env";
import worker from "../src/worker";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";

const BASE = "https://matool-middleware-staging.example.invalid";

interface RecordsAntwort {
  records: Array<{ recordRef: string; values: Record<string, string> }>;
  total: number;
}

function runtime(plaintext: boolean): Env {
  return {
    ...env,
    APP_ENV: "staging",
    PUBLIC_DASHBOARD_PLAINTEXT: plaintext ? "true" : "false",
    PUBLIC_DASHBOARD_READ_ONLY: "true"
  } as Env;
}

async function ladeDatensaetze(
  suchbegriff: string,
  plaintext: boolean
): Promise<RecordsAntwort> {
  const parameters = new URLSearchParams({
    area: "interessenten",
    change: "all",
    direction: "desc",
    page: "1",
    pageSize: "100",
    sort: "lastSeenAt"
  });
  if (suchbegriff) {
    parameters.set("q", suchbegriff);
  }
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}/api/admin/v1/dashboard/records?${parameters}`),
    runtime(plaintext),
    context
  );
  await waitOnExecutionContext(context);
  expect(response.status).toBe(200);
  return (await response.json()) as RecordsAntwort;
}

/**
 * Die Seitengroessen im Formular und die serverseitig erlaubten Werte sind
 * zwei getrennte Listen. Laufen sie auseinander, antwortet der Hub mit 400
 * und die Ansicht bleibt leer -- ohne dass jemand einen Filter angefasst hat.
 */
describe("Seitengroessen des Dashboards", () => {
  const seitengroessen = (id: string): number[] => {
    const beginn = dashboardHtml.indexOf(`<select id="${id}"`);
    expect(beginn, `Auswahlfeld ${id} fehlt in der Seite`).toBeGreaterThan(-1);
    const block = dashboardHtml.slice(
      beginn,
      dashboardHtml.indexOf("</select>", beginn)
    );
    return [...block.matchAll(/value="(\d+)"/gu)].map((treffer) =>
      Number(treffer[1])
    );
  };

  it("bietet im Verlauf nur Seitengroessen an, die der Hub annimmt", () => {
    const werte = seitengroessen("activity-page-size");
    expect(werte.length).toBeGreaterThan(0);
    for (const wert of werte) {
      expect(() =>
        parseDashboardActivityQuery(
          new URL(`${BASE}/activity?page=1&pageSize=${wert}`)
        )
      ).not.toThrow();
    }
  });

  it("bietet in der Datenansicht nur Seitengroessen an, die der Hub annimmt", () => {
    const werte = seitengroessen("database-page-size");
    expect(werte.length).toBeGreaterThan(0);
    for (const wert of werte) {
      expect(() =>
        parseDashboardRecordQuery(
          new URL(`${BASE}/records?area=interessenten&page=1&pageSize=${wert}`)
        )
      ).not.toThrow();
    }
  });
});

describe("Suche in der Datenansicht", () => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const nachname = `Suchprobe${suffix.slice(0, 8)}`;

  it("findet eine Person ueber Name, E-Mail und Ort", async () => {
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["email", "name", "ort", "status", "vorname"],
      area: "interessenten",
      finishedAt: "2099-09-01T10:00:02.000Z",
      observedAt: "2099-09-01T10:00:01.000Z",
      records: [
        {
          sourceId: `7${suffix.slice(0, 20)}`,
          payload: {
            email: `${nachname.toLowerCase()}@example.invalid`,
            name: nachname,
            ort: `Ortsprobe${suffix.slice(0, 8)}`,
            status: "Neu",
            vorname: "Lilli"
          }
        }
      ],
      runId: `suche_${suffix}`,
      startedAt: "2099-09-01T10:00:00.000Z"
    });

    for (const begriff of [
      nachname,
      nachname.toUpperCase(),
      `${nachname.toLowerCase()}@example.invalid`,
      `Ortsprobe${suffix.slice(0, 8)}`
    ]) {
      const antwort = await ladeDatensaetze(begriff, true);
      expect(antwort.total, `kein Treffer fuer "${begriff}"`).toBe(1);
      expect(antwort.records[0]?.values.name).toBe(nachname);
    }
  });

  it("findet einen Datensatz ueber die angezeigte Referenz", async () => {
    const alle = await ladeDatensaetze(nachname, true);
    const referenz = alle.records[0]?.recordRef ?? "";
    expect(referenz).toMatch(/^REC-[0-9A-F]{8}$/u);

    const gefunden = await ladeDatensaetze(referenz, true);
    expect(gefunden.total).toBe(1);
    expect(gefunden.records[0]?.recordRef).toBe(referenz);
  });

  it("verraet in der maskierten Ansicht keinen geschuetzten Wert", async () => {
    const antwort = await ladeDatensaetze(nachname, false);
    expect(antwort.total).toBe(0);
  });
});
