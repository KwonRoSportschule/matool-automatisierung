import { describe, expect, it } from "vitest";

import {
  probetrainingErinnerung,
  SCHLIESSZEITEN
} from "../src/triggers/probetraining-erinnerung.js";

// Donnerstag, 01.10.2026, 14:00 Uhr in Berlin
const JETZT = new Date("2026-10-01T12:00:00Z");

describe("Erinnerung vor Probetraining 1", () => {
  it.each([
    ["06.10.2026", "2026-10-05T10:00:00+02:00", "Dienstag → Montag"],
    ["05.10.2026", "2026-10-02T10:00:00+02:00", "Montag → Freitag"],
    ["2026-10-05", "2026-10-02T10:00:00+02:00", "MATOOL-Rohformat"],
    ["27.10.2026", "2026-10-26T10:00:00+01:00", "Winterzeit"],
    ["02.11.2026", "2026-10-30T10:00:00+01:00", "Allerheiligen am Sonntag"]
  ])("%s wird am letzten offenen Tag um 10 Uhr erinnert (%s, %s)", (datum, erwartet) => {
    expect(probetrainingErinnerung(datum, JETZT)).toBe(erwartet);
  });

  it.each([
    ["30.03.2027", "2027-03-25T10:00:00+01:00", "Ostermontag und Karfreitag"],
    ["28.05.2027", "2027-05-26T10:00:00+02:00", "Fronleichnam am Donnerstag"],
    ["16.08.2028", "2028-08-14T10:00:00+02:00", "Mariä Himmelfahrt"],
    ["02.05.2028", "2028-04-28T10:00:00+02:00", "Tag der Arbeit am Montag"],
    ["04.10.2028", "2028-10-02T10:00:00+02:00", "Tag der Deutschen Einheit"]
  ])("überspringt Feiertage in Rosenheim: %s → %s (%s)", (datum, erwartet) => {
    expect(probetrainingErinnerung(datum, JETZT)).toBe(erwartet);
  });

  it("behandelt das Augsburger Friedensfest als normalen Werktag", () => {
    expect(probetrainingErinnerung("09.08.2028", JETZT)).toBe(
      "2028-08-08T10:00:00+02:00"
    );
  });

  it.each([
    ["11.01.2027", "2026-12-23T10:00:00+01:00", "Montag nach den Weihnachtsferien"],
    ["06.09.2027", "2027-08-27T10:00:00+02:00", "Montag nach der vorletzten Sommerferienwoche"],
    ["02.09.2027", "2027-08-27T10:00:00+02:00", "Termin in der Schließwoche"],
    ["13.09.2027", "2027-09-10T10:00:00+02:00", "letzte Sommerferienwoche ist offen"]
  ])("erinnert vor Schließzeiten: %s → %s (%s)", (datum, erwartet) => {
    expect(probetrainingErinnerung(datum, JETZT)).toBe(erwartet);
  });

  it("erinnert sofort, wenn der Erinnerungstag heute schon nach 10 Uhr ist", () => {
    expect(probetrainingErinnerung("02.10.2026", JETZT)).toBe(
      "2026-10-01T14:00:00+02:00"
    );
    expect(probetrainingErinnerung("01.10.2026", JETZT)).toBe(
      "2026-10-01T14:00:00+02:00"
    );
  });

  it("verschiebt verpasste Erinnerungen auf den nächsten offenen Morgen", () => {
    // In den Weihnachtsferien eingetragen: erst am ersten offenen Tag
    expect(
      probetrainingErinnerung("11.01.2027", new Date("2026-12-28T09:00:00Z"))
    ).toBe("2027-01-11T10:00:00+01:00");
    // Samstag (Tag der Deutschen Einheit) für Montag eingetragen
    expect(
      probetrainingErinnerung("05.10.2026", new Date("2026-10-03T09:00:00Z"))
    ).toBe("2026-10-05T10:00:00+02:00");
  });

  it("bleibt ohne gültiges oder zukünftiges Datum leer", () => {
    for (const datum of [
      "30.09.2026",
      "",
      "0000-00-00",
      "00.00.0000",
      "31.02.2027",
      "---",
      null,
      undefined
    ]) {
      expect(probetrainingErinnerung(datum, JETZT)).toBe("");
    }
  });

  it("führt jede Schließzeit sortiert, ohne Überschneidung und mit vollen Sommerwochen", () => {
    let ende = "";
    for (const [von, bis] of SCHLIESSZEITEN) {
      expect(von > ende).toBe(true);
      expect(bis >= von).toBe(true);
      ende = bis;
      if (von.slice(5, 7) === "08") {
        expect(new Date(`${von}T00:00:00Z`).getUTCDay()).toBe(1);
        expect(Date.parse(bis) - Date.parse(von)).toBe(6 * 86_400_000);
      }
    }
  });
});
