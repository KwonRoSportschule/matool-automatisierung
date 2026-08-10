import { describe, expect, it } from "vitest";

import {
  parseDashboardActivityQuery,
  parseDashboardOverviewQuery,
  parseDashboardRecordDetailQuery,
  parseDashboardRecordQuery
} from "../src/worker/dashboard-query";

describe("Dashboard-Abfrageparameter", () => {
  it("verwendet sichere Standardwerte", () => {
    expect(
      parseDashboardOverviewQuery(new URL("https://hub.invalid/dashboard"))
    ).toBe(7);
    expect(
      parseDashboardRecordQuery(
        new URL("https://hub.invalid/dashboard?area=klassen")
      )
    ).toEqual({
      area: "klassen",
      change: "all",
      direction: "desc",
      page: 1,
      pageSize: 25,
      query: "",
      sort: "lastSeenAt"
    });
  });

  it("akzeptiert alle freigegebenen Record-Parameter", () => {
    expect(
      parseDashboardRecordQuery(
        new URL(
          "https://hub.invalid/dashboard?area=klassen&page=2&pageSize=50&sort=firstSeenAt&direction=asc&change=updated&q=Montag"
        )
      )
    ).toMatchObject({
      area: "klassen",
      change: "updated",
      direction: "asc",
      page: 2,
      pageSize: 50,
      query: "Montag",
      sort: "firstSeenAt"
    });
  });

  it.each([
    "range=8",
    "range=7days",
    "range=7&range=30",
    "range=7&debug=true"
  ])("weist unsichere Overview-Abfrage '%s' ab", (query) => {
    expect(() =>
      parseDashboardOverviewQuery(
        new URL(`https://hub.invalid/dashboard?${query}`)
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_dashboard_query" }));
  });

  it.each([
    "area=klassen&page=1x",
    "area=klassen&pageSize=11",
    "area=unbekannt",
    "area=klassen&sort=payload_json",
    "area=klassen&direction=sideways",
    "area=klassen&q=a&q=b",
    "area=klassen&q=%00"
  ])("weist unsichere Record-Abfrage '%s' ab", (query) => {
    expect(() =>
      parseDashboardRecordQuery(
        new URL(`https://hub.invalid/dashboard?${query}`)
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_dashboard_query" }));
  });

  it("normalisiert Zeitfilter und verhindert rueckwaerts laufende Zeitraeume", () => {
    expect(
      parseDashboardActivityQuery(
        new URL(
          "https://hub.invalid/dashboard?area=schueler&kind=data&status=succeeded&from=2026-08-01T00:00:00%2B02:00&to=2026-08-02T00:00:00%2B02:00"
        )
      )
    ).toMatchObject({
      area: "schueler",
      from: "2026-07-31T22:00:00.000Z",
      kind: "data",
      status: "succeeded",
      to: "2026-08-01T22:00:00.000Z"
    });
    expect(() =>
      parseDashboardActivityQuery(
        new URL(
          "https://hub.invalid/dashboard?from=2026-08-02T00:00:00Z&to=2026-08-01T00:00:00Z"
        )
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_dashboard_query" }));
  });

  it("verlangt fuer Details genau einen freigegebenen Bereich", () => {
    expect(
      parseDashboardRecordDetailQuery(
        new URL("https://hub.invalid/dashboard?area=karte")
      )
    ).toBe("karte");
    expect(() =>
      parseDashboardRecordDetailQuery(
        new URL("https://hub.invalid/dashboard?area=karte&raw=true")
      )
    ).toThrowError(expect.objectContaining({ code: "invalid_dashboard_query" }));
  });
});
