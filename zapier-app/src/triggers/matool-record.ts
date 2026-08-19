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

export const SNAPSHOT_AREA_CHOICES = {
  interessenten: "Interessenten",
  interessenten_details: "Interessenten-Details",
  schueler: "Schüler / Mitglieder",
  pruefungen: "Prüfungen",
  checkin: "Check-ins",
  newsletter: "Newsletter",
  klassen: "Klassen",
  artikel: "Artikel",
  lager: "Lager",
  archiv: "Archiv",
  telemetrie: "Telemetrie",
  berichte: "Berichte",
  karte: "Karte"
} as const;

export const inputFields = defineInputFields([
  {
    key: "area",
    label: "MATOOL-Bereich",
    type: "string",
    required: true,
    default: "interessenten_details",
    helpText:
      "Welcher gespeicherte MATOOL-Bereich soll gelesen werden? Der Zap startet, sobald dort ein Datensatz neu ist oder sich geändert hat.",
    choices: SNAPSHOT_AREA_CHOICES
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

interface SnapshotRecord {
  area?: unknown;
  content_hash?: unknown;
  id?: unknown;
  source_id?: unknown;
  [field: string]: unknown;
}

interface SnapshotResponse {
  area?: unknown;
  count?: unknown;
  records?: unknown;
}

interface SubscriptionResponse {
  id?: unknown;
}

interface ZapierRecord {
  id: string;
  [field: string]: unknown;
}

const SAMPLE_LIMIT = 3;
const MAX_TECHNICAL_ID_LENGTH = 300;
const SNAPSHOT_SUBSCRIPTIONS_PATH =
  "/api/zapier/v1/snapshot-subscriptions";

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

function selectedArea(z: ZObject, value: unknown): string {
  const area = String(value ?? "interessenten_details");
  if (!Object.hasOwn(SNAPSHOT_AREA_CHOICES, area)) {
    throw new z.errors.Error(
      "Der ausgewählte MATOOL-Bereich ist ungültig.",
      "invalid_snapshot_area"
    );
  }
  return area;
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

function normalizedRecords(
  z: ZObject,
  value: unknown,
  area: string
): ZapierRecord[] {
  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length === 0) {
    invalidSnapshotResponse(z);
  }

  const records: ZapierRecord[] = [];
  const seenRecordIds = new Set<string>();
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      invalidSnapshotResponse(z);
    }
    const record = candidate as SnapshotRecord;
    const backendId = record.id;
    const sourceId = record.source_id;
    const contentHash = record.content_hash;
    if (
      typeof backendId !== "string" ||
      backendId.length === 0 ||
      backendId.length > MAX_TECHNICAL_ID_LENGTH ||
      !(
        /^[a-f0-9]{64}$/u.test(backendId) ||
        new RegExp(
          `^${area}:[A-Za-z0-9_-]{1,128}:[a-f0-9]{16}$`,
          "u"
        ).test(backendId)
      ) ||
      seenRecordIds.has(backendId) ||
      record.area !== area ||
      typeof sourceId !== "string" ||
      sourceId.length === 0 ||
      sourceId.length > 240 ||
      typeof contentHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(contentHash)
    ) {
      invalidSnapshotResponse(z);
    }
    seenRecordIds.add(backendId);

    records.push({
      ...record,
      // Die technische ID kommt aus der Middleware und bleibt unverändert.
      id: backendId,
      area,
      source_id: sourceId,
      matool_id: /^\d+$/u.test(sourceId) ? sourceId : null,
      content_hash: contentHash
    });
  }
  return records;
}

export const performSubscribe = (async (z, bundle) => {
  const area = selectedArea(z, bundle.inputData.area);
  const targetUrl = bundle.targetUrl;
  if (typeof targetUrl !== "string" || targetUrl.length === 0) {
    throw new z.errors.Error(
      "Zapier hat keine gültige Webhook-Adresse geliefert.",
      "invalid_hook_target"
    );
  }

  const response = await z.request<SubscriptionResponse>({
    method: "POST",
    url: middlewareApiUrl(SNAPSHOT_SUBSCRIPTIONS_PATH),
    body: {
      target_url: targetUrl,
      area,
      only_changed: isEnabled(bundle.inputData.only_changed)
    }
  });
  response.throwForStatus();

  if (!response.data || typeof response.data !== "object") {
    invalidSubscriptionResponse(z);
  }
  return { id: subscriptionId(z, response.data.id) };
}) satisfies WebhookTriggerPerformSubscribe<typeof inputFields>;

export const performUnsubscribe = (async (z, bundle) => {
  const id = subscriptionId(z, bundle.subscribeData?.id);
  const response = await z.request({
    method: "DELETE",
    url: middlewareApiUrl(
      `${SNAPSHOT_SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`
    )
  });
  response.throwForStatus();
  return { id };
}) satisfies WebhookTriggerPerformUnsubscribe<typeof inputFields>;

export const perform = (async (z, bundle) => {
  const area = selectedArea(z, bundle.inputData.area);
  return normalizedRecords(z, bundle.cleanedRequest, area);
}) satisfies WebhookTriggerPerform<typeof inputFields, ZapierRecord>;

export const performList = (async (z, bundle) => {
  const area = selectedArea(z, bundle.inputData.area);
  const query = new URLSearchParams({
    area,
    limit: String(SAMPLE_LIMIT),
    ...(isEnabled(bundle.inputData.only_changed)
      ? { only_changed: "true" }
      : {})
  });
  const response = await z.request<SnapshotResponse>({
    method: "GET",
    url: `${middlewareApiUrl(API_PATHS.snapshots)}?${query.toString()}`
  });
  response.throwForStatus();

  if (
    !response.data ||
    typeof response.data !== "object" ||
    response.data.area !== area ||
    !Array.isArray(response.data.records)
  ) {
    invalidSnapshotResponse(z);
  }
  return normalizedRecords(z, response.data.records, area);
}) satisfies WebhookTriggerPerformList<typeof inputFields, ZapierRecord>;

export const sample = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  area: "interessenten_details",
  source_id: "12345",
  matool_id: "12345",
  content_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  first_seen_at: "2026-08-10T09:00:00.000Z",
  last_seen_at: "2026-08-10T10:00:00.000Z",
  last_changed_at: "2026-08-10T10:00:00.000Z",
  is_new: false,
  datum: "09.08.2026",
  anrede: "Weiblich",
  vorname: "Beispiel",
  name: "Interessentin",
  strasse: "Beispielstraße 1",
  plz: "83022",
  ort: "Beispielort",
  telefon: "",
  handy: "+490000000000",
  email: "beispiel@example.invalid",
  quelle: "---",
  kontakt: "Probetrainingsformular",
  kontaktart: "E-Mail",
  schule: "Beispielschule",
  leistung: "Beispielleistung",
  einfuehrung: "",
  einfuehrung_zeit: "",
  einfuehrung_klasse: "",
  einfuehrung_klasse_name: "",
  einfuehrung_benutzer: "",
  einfuehrung_anwesend: "",
  ergebnis_einfuehrung: "",
  probetraining: "12.08.2026",
  probetraining_zeit: "15:00",
  probetraining_klasse: "synthetic-class-id",
  probetraining_klasse_name: "Beispielklasse",
  probetraining_benutzer: "",
  probetraining_anwesend: "",
  ergebnis_probetraining: "",
  status: "Termin",
  text: "Synthetische Anmerkung",
  werbung: "ohne",
  werbung_bezeichnung: "Ohne"
};

export default defineTrigger({
  key: "matool_record_v2",
  noun: "MATOOL-Datensatz",
  display: {
    label: "Neuer Oder Geänderter MATOOL-Datensatz",
    description:
      "Triggers when a stored MATOOL record in the selected area is new or changes. It never sends messages or changes MATOOL data."
  },
  operation: {
    type: "hook",
    inputFields,
    perform,
    performList,
    performSubscribe,
    performUnsubscribe,
    sample
  }
});
