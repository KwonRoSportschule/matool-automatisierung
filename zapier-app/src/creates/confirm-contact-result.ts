import {
  defineCreate,
  defineInputFields,
  type CreatePerform
} from "zapier-platform-core";

import {
  API_PATHS,
  SYNTHETIC_EVENT_ID,
  middlewareApiUrl
} from "../constants.js";

const inputFields = defineInputFields([
  {
    key: "event_id",
    label: "Ereignis-ID",
    type: "string",
    required: true
  },
  {
    key: "claim_id",
    label: "Claim-ID",
    type: "string",
    required: true
  },
  {
    key: "outcome",
    label: "Ergebnis",
    type: "string",
    required: true,
    choices: {
      succeeded: "Kontaktaktion erfolgreich",
      failed: "Kontaktaktion fehlgeschlagen"
    }
  },
  {
    key: "failure_code",
    label: "Technischer Fehlercode",
    type: "string",
    required: false,
    helpText:
      "Nur bei fehlgeschlagener Kontaktaktion: technischer Code ohne Personen- oder Nachrichtendaten."
  }
]);

interface ConfirmationResponse {
  confirmed: boolean;
  state: string;
}

export const perform = (async (z, bundle) => {
  const failureCode =
    bundle.inputData.outcome === "failed"
      ? bundle.inputData.failure_code || "contact_action_failed"
      : null;
  const response = await z.request<ConfirmationResponse>({
    method: "POST",
    url: middlewareApiUrl(API_PATHS.confirm),
    body: {
      event_id: bundle.inputData.event_id,
      claim_id: bundle.inputData.claim_id,
      outcome: bundle.inputData.outcome,
      failure_code: failureCode
    }
  });
  response.throwForStatus();
  if (
    response.data.confirmed !== true ||
    (
      response.data.state !== "confirmed" &&
      response.data.state !== "already_confirmed"
    )
  ) {
    throw new z.errors.Error(
      "Die Middleware hat das Kontakt-Ergebnis nicht bestätigt.",
      "claim_not_confirmed",
      409
    );
  }
  return {
    id: bundle.inputData.event_id,
    event_id: bundle.inputData.event_id,
    confirmed: response.data.confirmed,
    state: response.data.state
  };
}) satisfies CreatePerform<typeof inputFields>;

export default defineCreate({
  key: "confirm_contact_result",
  noun: "Kontakt-Ergebnis",
  display: {
    label: "Kontakt-Ergebnis melden",
    description:
      "Meldet der Middleware nach der Kontaktaktion Erfolg oder einen technischen Fehler."
  },
  operation: {
    inputFields,
    perform,
    sample: {
      id: SYNTHETIC_EVENT_ID,
      event_id: SYNTHETIC_EVENT_ID,
      confirmed: true,
      state: "confirmed"
    }
  }
});
