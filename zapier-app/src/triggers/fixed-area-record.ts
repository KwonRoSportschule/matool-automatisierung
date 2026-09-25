import {
  defineInputFields,
  defineTrigger,
  type WebhookTriggerPerform,
  type WebhookTriggerPerformList,
  type WebhookTriggerPerformSubscribe,
  type WebhookTriggerPerformUnsubscribe,
  type ZObject
} from "zapier-platform-core";

import { API_PATHS, middlewareApiUrl } from "../constants.js";
import {
  normalizeSnapshotRecords,
  type ZapierRecord
} from "./matool-record.js";

const MAX_TECHNICAL_ID_LENGTH = 300;
const SNAPSHOT_SUBSCRIPTIONS_PATH =
  "/api/zapier/v1/snapshot-subscriptions";

interface SnapshotResponse {
  area?: unknown;
  records?: unknown;
}

export interface FixedAreaTriggerDefinition {
  area: string;
  description: string;
  key: string;
  label: string;
  noun: string;
  onlyNewHelpText?: string;
  onlyNewLabel?: string;
  sample: ZapierRecord;
}

function invalidSnapshotResponse(z: ZObject): never {
  throw new z.errors.Error(
    "Die Middleware hat keine gültige Datensatzliste geliefert.",
    "invalid_snapshot_response"
  );
}

function invalidSubscriptionResponse(z: ZObject): never {
  throw new z.errors.Error(
    "Die Middleware hat keine gültige Subscription-ID geliefert.",
    "invalid_snapshot_subscription_response"
  );
}

function isEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

function changeSelection(inputData: Record<string, unknown>): {
  onlyChanged: boolean;
  onlyNew: boolean;
} {
  const onlyNew = isEnabled(inputData.only_new);
  return {
    // "Nur neue Datensätze" hat Vorrang, falls ein älterer Zap noch beide
    // Felder gespeichert hat. So kann nie versehentlich kein Ereignis passen.
    onlyChanged: !onlyNew && isEnabled(inputData.only_changed),
    onlyNew
  };
}

function subscriptionId(z: ZObject, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TECHNICAL_ID_LENGTH
  ) {
    invalidSubscriptionResponse(z);
  }
  return value;
}

/**
 * Exposes a clearly named Zapier trigger for a fixed MATOOL area while using
 * the same REST-hook contract and immutable event IDs as the generic trigger.
 */
export function createFixedAreaRecordTrigger(
  definition: FixedAreaTriggerDefinition
) {
  const fixedAreaInputFields = defineInputFields([
    {
      key: "only_new",
      label: definition.onlyNewLabel ?? "Nur neue Datensätze",
      type: "boolean",
      required: false,
      default: "false",
      helpText:
        definition.onlyNewHelpText ??
        "Aktiviert: der Zap startet ausschließlich, wenn ein Datensatz erstmals in MATOOL erscheint. Änderungen an bestehenden Datensätzen werden nicht gemeldet."
    },
    {
      key: "only_changed",
      label: "Nur Änderungen",
      type: "boolean",
      required: false,
      default: "false",
      helpText:
        "Aktiviert: nur bereits bekannte Datensätze melden, deren Inhalt sich geändert hat. Deaktiviert: neue und geänderte Datensätze melden."
    }
  ]);

  const performSubscribe = (async (z, bundle) => {
    const targetUrl = bundle.targetUrl;
    if (typeof targetUrl !== "string" || targetUrl.length === 0) {
      throw new z.errors.Error(
        "Zapier hat keine gültige Webhook-Adresse geliefert.",
        "invalid_hook_target"
      );
    }

    const selection = changeSelection(bundle.inputData);
    const response = await z.request<{ id?: unknown }>({
      method: "POST",
      url: middlewareApiUrl(SNAPSHOT_SUBSCRIPTIONS_PATH),
      body: {
        target_url: targetUrl,
        area: definition.area,
        only_changed: selection.onlyChanged,
        only_new: selection.onlyNew
      }
    });
    response.throwForStatus();
    if (!response.data || typeof response.data !== "object") {
      invalidSubscriptionResponse(z);
    }
    return { id: subscriptionId(z, response.data.id) };
  }) satisfies WebhookTriggerPerformSubscribe<typeof fixedAreaInputFields>;

  const performUnsubscribe = (async (z, bundle) => {
    const id = subscriptionId(z, bundle.subscribeData?.id);
    const response = await z.request({
      method: "DELETE",
      url: middlewareApiUrl(
        `${SNAPSHOT_SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`
      )
    });
    response.throwForStatus();
    return { id };
  }) satisfies WebhookTriggerPerformUnsubscribe<typeof fixedAreaInputFields>;

  const perform = (async (z, bundle) =>
    normalizeSnapshotRecords(z, bundle.cleanedRequest, definition.area)
  ) satisfies WebhookTriggerPerform<typeof fixedAreaInputFields, ZapierRecord>;

  const performList = (async (z, bundle) => {
    const selection = changeSelection(bundle.inputData);
    const query = new URLSearchParams({
      area: definition.area,
      limit: "3",
      ...(selection.onlyChanged
        ? { only_changed: "true" }
        : {}),
      ...(selection.onlyNew ? { only_new: "true" } : {})
    });
    const response = await z.request<SnapshotResponse>({
      method: "GET",
      url: `${middlewareApiUrl(API_PATHS.snapshots)}?${query.toString()}`
    });
    response.throwForStatus();
    if (
      !response.data ||
      typeof response.data !== "object" ||
      response.data.area !== definition.area ||
      !Array.isArray(response.data.records)
    ) {
      invalidSnapshotResponse(z);
    }
    return normalizeSnapshotRecords(z, response.data.records, definition.area);
  }) satisfies WebhookTriggerPerformList<
    typeof fixedAreaInputFields,
    ZapierRecord
  >;

  return defineTrigger({
    key: definition.key,
    noun: definition.noun,
    display: {
      label: definition.label,
      description: definition.description
    },
    operation: {
      type: "hook",
      inputFields: fixedAreaInputFields,
      perform,
      performList,
      performSubscribe,
      performUnsubscribe,
      sample: definition.sample
    }
  });
}
