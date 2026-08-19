import {
  defineTrigger,
  type PollingTriggerPerform,
  type ZObject
} from "zapier-platform-core";

import { API_PATHS, middlewareApiUrl } from "../constants.js";
import {
  inputFields,
  sample,
  SNAPSHOT_AREA_CHOICES
} from "./matool-record.js";

interface SnapshotRecord {
  content_hash?: unknown;
  source_id?: unknown;
  [field: string]: unknown;
}

interface SnapshotResponse {
  area?: unknown;
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

export const performLegacy = (async (z, bundle) => {
  const area = String(
    bundle.inputData.area ?? "interessenten_details"
  );
  if (!Object.hasOwn(SNAPSHOT_AREA_CHOICES, area)) {
    throw new z.errors.Error(
      "Der ausgewählte MATOOL-Bereich ist ungültig.",
      "invalid_snapshot_area"
    );
  }

  const query = new URLSearchParams({
    area,
    limit: "100",
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

  return response.data.records.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
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
      id: `${area}:${sourceId}:${contentHash.slice(0, 16)}`,
      area,
      source_id: sourceId,
      matool_id: /^\d+$/u.test(sourceId) ? sourceId : null,
      content_hash: contentHash
    };
  });
}) satisfies PollingTriggerPerform<typeof inputFields>;

export default defineTrigger({
  key: "matool_record",
  noun: "MATOOL-Datensatz",
  display: {
    hidden: true,
    label: "Neuer Oder Geänderter MATOOL-Datensatz (Legacy)",
    description:
      "Legacy polling trigger retained only for existing Zap workflows."
  },
  operation: {
    type: "polling",
    inputFields,
    perform: performLegacy,
    sample
  }
});
