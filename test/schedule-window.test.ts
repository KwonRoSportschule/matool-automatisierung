import { describe, expect, it } from "vitest";

import { evaluateBerlinScheduleWindow } from "../src/worker/schedule-window";

describe("Berlin-Zeitfenster für Schleswig-Holstein", () => {
  it.each([
    ["2026-01-07T07:00:00.000Z", 8, false],
    ["2026-01-07T08:00:00.000Z", 9, true],
    ["2026-01-07T18:00:00.000Z", 19, true],
    ["2026-01-07T19:00:00.000Z", 20, false],
    ["2026-07-08T06:00:00.000Z", 8, false],
    ["2026-07-08T07:00:00.000Z", 9, true],
    ["2026-07-08T17:00:00.000Z", 19, true],
    ["2026-07-08T18:00:00.000Z", 20, false]
  ])(
    "wertet %s als Berliner Stunde %i mit allowed=%s",
    (isoTime, expectedHour, expectedAllowed) => {
      expect(
        evaluateBerlinScheduleWindow(new Date(isoTime))
      ).toMatchObject({
        allowed: expectedAllowed,
        localHour: expectedHour
      });
    }
  );

  it.each([
    ["2026-03-27T08:00:00.000Z", 9],
    ["2026-03-30T07:00:00.000Z", 9],
    ["2026-10-23T07:00:00.000Z", 9],
    ["2026-10-26T08:00:00.000Z", 9]
  ])(
    "berücksichtigt den Berliner DST-Wechsel bei %s",
    (isoTime, expectedHour) => {
      expect(
        evaluateBerlinScheduleWindow(new Date(isoTime))
      ).toMatchObject({
        allowed: true,
        localHour: expectedHour,
        reason: "within_window"
      });
    }
  );

  it("weist Samstage und Sonntage ab", () => {
    expect(
      evaluateBerlinScheduleWindow(
        new Date("2026-07-11T08:00:00.000Z")
      )
    ).toMatchObject({
      allowed: false,
      localDate: "2026-07-11",
      reason: "weekend"
    });
    expect(
      evaluateBerlinScheduleWindow(
        new Date("2026-07-12T08:00:00.000Z")
      )
    ).toMatchObject({
      allowed: false,
      localDate: "2026-07-12",
      reason: "weekend"
    });
  });

  it.each([
    ["2026-01-01", "new_years_day"],
    ["2026-04-03", "good_friday"],
    ["2026-04-06", "easter_monday"],
    ["2026-05-01", "labour_day"],
    ["2026-05-14", "ascension_day"],
    ["2026-05-25", "whit_monday"],
    ["2026-10-03", "german_unity_day"],
    ["2026-10-31", "reformation_day"],
    ["2026-12-25", "christmas_day"],
    ["2026-12-26", "second_christmas_day"]
  ])(
    "weist den SH-Feiertag %s als %s ab",
    (localDate, holiday) => {
      expect(
        evaluateBerlinScheduleWindow(
          new Date(`${localDate}T12:00:00.000Z`)
        )
      ).toMatchObject({
        allowed: false,
        holiday,
        localDate,
        reason: "public_holiday"
      });
    }
  );

  it("lässt einen gewöhnlichen Werktag zu", () => {
    expect(
      evaluateBerlinScheduleWindow(
        new Date("2026-01-02T11:00:00.000Z")
      )
    ).toEqual({
      allowed: true,
      localDate: "2026-01-02",
      localHour: 12,
      reason: "within_window"
    });
  });
});
