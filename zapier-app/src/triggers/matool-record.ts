import {
  defineInputFields,
  defineTrigger,
  type PollingTriggerPerform
} from "zapier-platform-core";

import { API_PATHS, middlewareApiUrl } from "../constants.js";

const inputFields = defineInputFields([
  {
    key: "area",
    label: "MATOOL-Bereich",
    type: "string",
    required: true,
    default: "interessenten",
    helpText:
      "Welcher MATOOL-Bereich soll überwacht werden? Der Zap startet, sobald dort ein Datensatz neu ist oder sich geändert hat.",
    choices: {
      interessenten: "Interessenten",
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
    }
  },
  {
    key: "only_changed",
    label: "Nur Änderungen",
    type: "boolean",
    required: false,
    default: "false",
    helpText:
      "Aktiviert: nur Datensätze melden, die sich seit dem ersten Erfassen geändert haben. Deaktiviert: auch neu erfasste Datensätze melden."
  }
]);

interface SnapshotRecord {
  id: string;
  [field: string]: unknown;
}

interface SnapshotResponse {
  area: string;
  count: number;
  records: SnapshotRecord[];
}

export const perform = (async (z, bundle) => {
  const area = String(bundle.inputData.area ?? "interessenten");
  const onlyChanged = bundle.inputData.only_changed === true;
  const query = new URLSearchParams({
    area,
    limit: "150",
    ...(onlyChanged ? { only_changed: "true" } : {})
  });

  const response = await z.request<SnapshotResponse>({
    method: "GET",
    url: `${middlewareApiUrl(API_PATHS.snapshots)}?${query.toString()}`
  });
  response.throwForStatus();

  if (!Array.isArray(response.data.records)) {
    throw new z.errors.Error(
      "Die Middleware hat keine gültige Datensatzliste geliefert.",
      "invalid_snapshot_response"
    );
  }
  return response.data.records;
}) satisfies PollingTriggerPerform<typeof inputFields>;

export default defineTrigger({
  key: "matool_record",
  noun: "MATOOL-Datensatz",
  display: {
    label: "Neuer oder geänderter MATOOL-Datensatz",
    description:
      "Triggers when a MATOOL record in the selected area is new or has changed."
  },
  operation: {
    type: "polling",
    inputFields,
    perform,
    sample: {
      id: "interessenten:12345:0123456789abcdef",
      area: "interessenten",
      source_id: "12345",
      matool_id: "12345",
      content_hash: "0123456789abcdef0123456789abcdef",
      first_seen_at: "2026-07-30T09:00:00.000Z",
      last_seen_at: "2026-07-31T09:00:00.000Z",
      is_new: false,
      tableIndex: 4,
      columnCount: 5,
      c00: "1234",
      c01: "30.07.2026",
      c02: "Beispiel",
      c03: "Beispielperson",
      c04: "Probetraining"
    }
  }
});
