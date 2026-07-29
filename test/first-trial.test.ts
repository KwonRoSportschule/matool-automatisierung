import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import {
  buildFirstTrialEventId,
  buildProspectContactEvent,
  buildSourceRevision,
  evaluateFirstTrialContact,
  type FirstTrialPolicy,
  type ProspectFirstTrial
} from "../src/core/first-trial";

const record: ProspectFirstTrial = {
  prospectId: "synthetic-prospect-17",
  trialAppointmentId: "synthetic-appointment-4",
  firstTrialStartsAt: "2026-08-04T16:00:00.000Z",
  firstName: "Mira",
  email: "mira@example.invalid",
  phone: null,
  locationCode: "synthetic-location"
};

const policy: FirstTrialPolicy = {
  contactChannel: "email",
  contactLeadMinutes: 24 * 60,
  lookbackMinutes: 120
};

describe("Interessenten vor dem ersten Probetraining", () => {
  it("erkennt das freigegebene Kontaktfenster", () => {
    const result = evaluateFirstTrialContact(
      record,
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );

    expect(result).toEqual({
      state: "due",
      reason: "contact_due",
      dueAt: "2026-08-03T16:00:00.000Z"
    });
  });

  it("kontaktiert weder zu früh noch nach Beginn des Probetrainings", () => {
    expect(
      evaluateFirstTrialContact(
        record,
        policy,
        new Date("2026-08-03T15:59:59.000Z")
      ).state
    ).toBe("pending");
    expect(
      evaluateFirstTrialContact(
        record,
        policy,
        new Date("2026-08-04T16:00:00.000Z")
      ).reason
    ).toBe("trial_already_started");
  });

  it("schließt einen E-Mail-Kontakt ohne E-Mail-Adresse aus", () => {
    const result = evaluateFirstTrialContact(
      { ...record, email: null },
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );
    expect(result.reason).toBe("missing_email");
  });

  it("hält die Ereignis-ID bei reiner Terminkorrektur stabil", async () => {
    const corrected = {
      ...record,
      firstTrialStartsAt: "2026-08-04T17:00:00.000Z"
    };

    await expect(buildFirstTrialEventId(corrected)).resolves.toBe(
      await buildFirstTrialEventId(record)
    );
    await expect(buildSourceRevision(corrected)).resolves.not.toBe(
      await buildSourceRevision(record)
    );
  });

  it("erzeugt für einen wirklich anderen Termin eine neue Ereignis-ID", async () => {
    await expect(
      buildFirstTrialEventId({
        ...record,
        trialAppointmentId: "synthetic-appointment-5"
      })
    ).resolves.not.toBe(await buildFirstTrialEventId(record));
  });

  it("baut ein minimales versioniertes Ereignis", async () => {
    const event = await buildProspectContactEvent(
      record,
      policy,
      new Date("2026-08-03T16:30:00.000Z")
    );

    expect(event.eventType).toBe("prospect.first_trial_contact_due");
    expect(event.payloadVersion).toBe(1);
    expect(event.sourceKey).toBe("matool:prospect:synthetic-prospect-17");
    expect(event.firstTrial.appointmentId).toBe("synthetic-appointment-4");
  });

  it("verweigert veränderliche Ersatzschlüssel", async () => {
    await expect(
      buildFirstTrialEventId({
        ...record,
        trialAppointmentId: ""
      })
    ).rejects.toMatchObject({
      code: "missing_trial_appointment_id"
    } satisfies Partial<AppError>);
  });
});
