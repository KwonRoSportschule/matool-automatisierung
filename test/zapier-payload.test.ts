import { describe, expect, it } from "vitest";

import { projectSnapshotPayloadForZapier } from "../src/core/zapier-payload";

describe("Zapier-Payload-Projektion", () => {
  it("entfernt Bank- und Zahlungsdaten aus Mitglieder-Details", () => {
    const projected = projectSnapshotPayloadForZapier("schueler_details", {
      iban: "DE00123456780000000000",
      bic: "SYNTHETICBIC",
      konto: "12345678",
      bank: "Synthetische Bank",
      beitrag: "79.00",
      email: "mitglied@example.invalid",
      name: "Beispiel",
      schueler_nr: "42",
      vertragid: "contract-42",
      vertragsende: "2027-08-01",
      vname: "Mitglied",
      zahlart: "SEPA"
    });

    expect(projected).toEqual({
      email: "mitglied@example.invalid",
      name: "Beispiel",
      schueler_nr: "42",
      vertragid: "contract-42",
      vertragsende: "2027-08-01",
      vname: "Mitglied"
    });
    expect(projected).not.toHaveProperty("iban");
    expect(projected).not.toHaveProperty("bic");
    expect(projected).not.toHaveProperty("konto");
    expect(projected).not.toHaveProperty("beitrag");
    expect(projected).not.toHaveProperty("zahlart");
  });

  it("behält Nicht-Mitgliederbereiche unverändert", () => {
    const payload = { email: "interessent@example.invalid", status: "Termin" };
    expect(projectSnapshotPayloadForZapier("interessenten_details", payload)).toEqual(
      payload
    );
  });

  it("sperrt Bankverbindungsfelder in jedem Bereich", () => {
    for (const area of ["schueler", "schueler_ex", "interessenten_details"]) {
      const projected = projectSnapshotPayloadForZapier(area, {
        BIC: "SYNTHETICBIC",
        bank: "Synthetische Bank",
        blz: "12345678",
        iban: "DE00123456780000000000",
        kontakt: "Telefon",
        konto: "12345678",
        kontoinhaber: "Beispiel",
        mandatsreferenz: "MANDAT-1",
        name: "Beispiel",
        zahlart: "SEPA",
        zahlungsart: "Lastschrift"
      });

      // "kontakt" bleibt: gesperrt werden exakte Feldnamen, keine Praefixe.
      expect(projected, area).toEqual({ kontakt: "Telefon", name: "Beispiel" });
    }
  });
});
