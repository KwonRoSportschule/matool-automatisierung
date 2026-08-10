import {
  defineInputFields,
  defineTrigger,
  type PollingTriggerPerform,
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

function invalidSnapshotResponse(z: ZObject): never {
  throw new z.errors.Error(
    "Die Middleware hat keine gültige Datensatzliste geliefert.",
    "invalid_snapshot_response"
  );
}

function isEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

export const perform = (async (z, bundle) => {
  const area = String(
    bundle.inputData.area ?? "interessenten_details"
  );
  if (!Object.hasOwn(SNAPSHOT_AREA_CHOICES, area)) {
    throw new z.errors.Error(
      "Der ausgewählte MATOOL-Bereich ist ungültig.",
      "invalid_snapshot_area"
    );
  }

  const onlyChanged = isEnabled(bundle.inputData.only_changed);
  const query = new URLSearchParams({
    area,
    limit: "100",
    ...(onlyChanged ? { only_changed: "true" } : {})
  });

  const response = await z.request<SnapshotResponse>({
    method: "GET",
    url: `${middlewareApiUrl(API_PATHS.snapshots)}?${query.toString()}`
  });
  response.throwForStatus();

  if (
    response.data.area !== area ||
    !Array.isArray(response.data.records)
  ) {
    invalidSnapshotResponse(z);
  }

  return response.data.records.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      invalidSnapshotResponse(z);
    }
    const record = candidate as SnapshotRecord;
    const sourceId = record.source_id;
    const contentHash = record.content_hash;
    if (
      typeof sourceId !== "string" ||
      sourceId.length === 0 ||
      sourceId.length > 240 ||
      typeof contentHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(contentHash)
    ) {
      invalidSnapshotResponse(z);
    }

    return {
      ...record,
      // Zapier dedupliziert Polling-Ergebnisse über `id`. Technische Felder
      // werden deshalb nach dem MATOOL-Payload gesetzt und können von diesem
      // nicht überschrieben werden.
      id: `${area}:${sourceId}:${contentHash.slice(0, 16)}`,
      area,
      source_id: sourceId,
      matool_id: /^\d+$/u.test(sourceId) ? sourceId : null,
      content_hash: contentHash
    };
  });
}) satisfies PollingTriggerPerform<typeof inputFields>;

export const sample = {
  id: "interessenten_details:12345:0123456789abcdef",
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
  key: "matool_record",
  noun: "MATOOL-Datensatz",
  display: {
    label: "Neuer Oder Geänderter MATOOL-Datensatz",
    description:
      "Triggers when a stored MATOOL record in the selected area is new or changes. It never sends messages or changes MATOOL data."
  },
  operation: {
    type: "polling",
    inputFields,
    perform,
    sample
  }
});
