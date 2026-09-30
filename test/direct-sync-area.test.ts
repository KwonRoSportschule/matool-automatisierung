import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatoolClient } from "../src/matool/client";
import { isDirectSyncLeaseHeld } from "../src/worker/direct-sync-store";
import type { Env } from "../src/worker/env";
import {
  isRetryableAreaError,
  releaseDirectSyncLease,
  syncDirectArea
} from "../src/worker/schedule";
import { beginMatoolSyncRun } from "../src/worker/sync-store";

const testEnv = {
  ...env,
  MATOOL_EMAIL: "direct-area-test@example.invalid",
  MATOOL_PASSWORD: "synthetic-direct-area-password",
  OUTBOUND_DELIVERY_ENABLED: "false"
} as Env;

function checkinRecords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    payload: {
      checkin_datum: "2098-09-01",
      checkin_uhrzeit: "17:30",
      checkin_zeitpunkt: "2098-09-01T17:30:00",
      klasse_id: "12",
      mitglied_id: String(760000 + index)
    },
    sourceId: `checkin_${760000 + index}`
  }));
}

describe("ein Bereich als eigenstaendige, wiederholbare Einheit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("behaelt die Sperre ueber mehrere Bereiche, sperrt fremde Laeufe aus und gibt sie frei", async () => {
    const owner = `wf_test_${crypto.randomUUID().slice(0, 8)}`;
    const syncId = await beginMatoolSyncRun(env.DB, {
      startedAt: new Date().toISOString(),
      trigger: "manual"
    });
    vi.spyOn(MatoolClient.prototype, "extractCheckins").mockResolvedValue({
      area: "checkin",
      bodyBytes: 10,
      records: checkinRecords(3),
      rowCount: 3
    });
    vi.spyOn(MatoolClient.prototype, "extractGraduierungen").mockResolvedValue({
      area: "graduierungen",
      bodyBytes: 2,
      processedSourceIds: [],
      records: [],
      rowCount: 0
    });
    const lauf = { leaseOwner: owner, scheduledTime: Date.now(), syncId, trigger: "manual" as const };

    await expect(syncDirectArea(testEnv, "checkin", lauf)).resolves.toMatchObject({
      area: "checkin",
      status: "succeeded",
      storedCount: 3
    });
    // Derselbe Besitzer uebernimmt die Sperre fuer den naechsten Bereich erneut.
    await expect(syncDirectArea(testEnv, "graduierungen", lauf)).resolves.toMatchObject({
      status: "succeeded"
    });
    await expect(isDirectSyncLeaseHeld(env.DB)).resolves.toBe(true);
    await expect(isDirectSyncLeaseHeld(env.DB, new Date(), owner)).resolves.toBe(false);

    // Ein anderer Lauf kommt nicht dazwischen -- und darf es spaeter erneut versuchen.
    const fremd = await syncDirectArea(testEnv, "checkin", {
      ...lauf,
      leaseOwner: "wf_fremder_lauf"
    });
    expect(fremd).toMatchObject({
      errorCode: "matool_exact_sync_busy",
      retryable: true,
      status: "failed"
    });

    await releaseDirectSyncLease(env.DB, owner);
    await expect(isDirectSyncLeaseHeld(env.DB)).resolves.toBe(false);
  });

  it("meldet ohne Zugangsdaten einen nicht wiederholbaren Fehler", async () => {
    const result = await syncDirectArea(
      { ...testEnv, MATOOL_EMAIL: "" } as Env,
      "checkin",
      {
        leaseOwner: "wf_ohne_zugang",
        recordFailure: false,
        scheduledTime: Date.now(),
        syncId: "sync_ohne_zugang",
        trigger: "manual"
      }
    );
    expect(result).toMatchObject({
      errorCode: "matool_not_configured",
      retryable: false,
      status: "failed"
    });
  });

  it("wiederholt nur, was ein zweiter Versuch heilen kann", () => {
    expect(isRetryableAreaError("matool_network_error")).toBe(true);
    expect(isRetryableAreaError("matool_paginated_list_schema_mismatch")).toBe(true);
    expect(isRetryableAreaError("matool_authentication_unverified")).toBe(true);
    expect(isRetryableAreaError("matool_login_failed")).toBe(false);
    expect(isRetryableAreaError("matool_exact_source_implausible_shrink")).toBe(false);
    expect(isRetryableAreaError("stored_payload_key_missing")).toBe(false);
    expect(isRetryableAreaError(undefined)).toBe(false);
  });
});

describe("Kontrolllesen der Interessentenliste", () => {
  it("liest die Liste nur nach langen Abgleichen ein zweites Mal", async () => {
    const { needsFinalListCheck } = await import("../src/worker/interessenten-sync-workflow");
    const start = "2098-09-01T07:00:00.000Z";
    expect(needsFinalListCheck(start, Date.parse("2098-09-01T07:05:00.000Z"))).toBe(false);
    expect(needsFinalListCheck(start, Date.parse("2098-09-01T07:15:00.000Z"))).toBe(true);
    expect(needsFinalListCheck("kaputt", Date.parse("2098-09-01T07:01:00.000Z"))).toBe(true);
  });
});
