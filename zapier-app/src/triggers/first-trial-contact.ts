import {
  defineInputFields,
  defineTrigger,
  type WebhookTriggerPerform,
  type WebhookTriggerPerformList,
  type WebhookTriggerPerformSubscribe,
  type WebhookTriggerPerformUnsubscribe
} from "zapier-platform-core";

import {
  API_PATHS,
  FIRST_TRIAL_EVENT_TYPE,
  SYNTHETIC_CLAIM_ID,
  SYNTHETIC_EVENT_ID,
  middlewareApiUrl
} from "../constants.js";
import { verifyWebhookRequest } from "../webhook-security.js";

const inputFields = defineInputFields([]);

interface SubscriptionResponse {
  event_type: string;
  id: string;
  schema_version: number;
}

interface ClaimResponse {
  claimed: boolean;
  event?: Record<string, unknown>;
  state: string;
}

interface SampleResponse {
  events: Record<string, unknown>[];
}

export const performSubscribe = (async (z, bundle) => {
  if (!bundle.targetUrl) {
    throw new z.errors.Error(
      "Zapier hat keine Zieladresse für den REST Hook bereitgestellt.",
      "missing_target_url"
    );
  }
  const response = await z.request<SubscriptionResponse>({
    method: "POST",
    url: middlewareApiUrl(API_PATHS.subscriptions),
    body: {
      event_type: FIRST_TRIAL_EVENT_TYPE,
      target_url: bundle.targetUrl
    }
  });
  response.throwForStatus();
  return response.data;
}) satisfies WebhookTriggerPerformSubscribe<typeof inputFields>;

export const performUnsubscribe = (async (z, bundle) => {
  const subscriptionId = bundle.subscribeData?.id;
  if (!subscriptionId) {
    return { disabled: true };
  }
  const response = await z.request<Record<string, unknown>>({
    method: "DELETE",
    url: middlewareApiUrl(
      `${API_PATHS.subscriptions}/${subscriptionId}`
    ),
    skipThrowForStatus: true
  });
  if (response.status === 404 || response.status === 410) {
    return { disabled: true };
  }
  response.throwForStatus();
  return response.data;
}) satisfies WebhookTriggerPerformUnsubscribe<typeof inputFields>;

export const perform = (async (z, bundle) => {
  const envelope = verifyWebhookRequest(
    bundle.rawRequest,
    bundle.authData.webhook_signing_secret ?? ""
  );
  const response = await z.request<ClaimResponse>({
    method: "POST",
    url: middlewareApiUrl(API_PATHS.claim),
    skipThrowForStatus: true,
    body: {
      delivery_id: envelope.delivery_id,
      delivery_token: envelope.delivery_token,
      event_id: envelope.event_id
    }
  });

  if (response.status === 429) {
    throw new z.errors.ThrottledError(
      "Die Middleware begrenzt Anfragen vorübergehend.",
      30
    );
  }
  response.throwForStatus();
  if (!response.data.claimed) {
    return [];
  }
  if (!response.data.event || typeof response.data.event.id !== "string") {
    throw new z.errors.Error(
      "Die Middleware hat kein gültiges Ereignis geliefert.",
      "invalid_claim_response"
    );
  }
  return [response.data.event];
}) satisfies WebhookTriggerPerform<typeof inputFields>;

export const performList = (async (z, bundle) => {
  const response = await z.request<SampleResponse>({
    method: "POST",
    url: middlewareApiUrl(API_PATHS.sample),
    body: {
      event_type: FIRST_TRIAL_EVENT_TYPE
    }
  });
  response.throwForStatus();
  return response.data.events;
}) satisfies WebhookTriggerPerformList<typeof inputFields>;

export default defineTrigger({
  key: "first_trial_contact_due",
  noun: "Probetraining-Kontakt",
  display: {
    label: "Interessent vor dem ersten Probetraining",
    description:
      "Startet einmalig, wenn die Middleware einen freigegebenen Kontakt vor dem ersten Probetraining bereitstellt."
  },
  operation: {
    type: "hook",
    inputFields,
    perform,
    performList,
    performSubscribe,
    performUnsubscribe,
    sample: {
      id: SYNTHETIC_EVENT_ID,
      event_id: SYNTHETIC_EVENT_ID,
      event_type: FIRST_TRIAL_EVENT_TYPE,
      claim_id: SYNTHETIC_CLAIM_ID,
      occurred_at: "2026-08-03T16:30:00.000Z",
      payload_version: 1,
      prospect: {
        first_name: "Beispiel",
        email: "beispiel@example.invalid",
        phone: null
      },
      first_trial: {
        appointment_id: "synthetic-appointment-id",
        starts_at: "2026-08-04T16:00:00.000Z",
        location_code: "synthetic-location"
      },
      contact: {
        channel: "email",
        due_at: "2026-08-03T16:00:00.000Z"
      }
    }
  }
});
