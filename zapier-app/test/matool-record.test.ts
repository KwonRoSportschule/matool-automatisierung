import { describe, expect, it } from "vitest";
import type {
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import app from "../src/index.js";
import authentication from "../src/authentication.js";
import matoolMemberRecord from "../src/triggers/matool-member-record.js";
import matoolExMemberRecord from "../src/triggers/matool-ex-member-record.js";
import matoolCheckinRecord from "../src/triggers/matool-checkin-record.js";
import matoolGraduierungRecord from "../src/triggers/matool-graduierung-record.js";
import { performLegacy } from "../src/triggers/matool-record-legacy.js";
import {
  perform,
  performList,
  performSubscribe,
  performUnsubscribe,
  sample,
  SNAPSHOT_AREA_CHOICES
} from "../src/triggers/matool-record.js";
import matoolProspectRecord from "../src/triggers/matool-prospect-record.js";

const detailKeys = [
  "matool_id",
  "datum",
  "anrede",
  "vorname",
  "name",
  "strasse",
  "plz",
  "ort",
  "telefon",
  "handy",
  "email",
  "quelle",
  "kontakt",
  "kontaktart",
  "schule",
  "leistung",
  "einfuehrung",
  "einfuehrung_zeit",
  "einfuehrung_klasse",
  "einfuehrung_klasse_name",
  "einfuehrung_benutzer",
  "einfuehrung_anwesend",
  "ergebnis_einfuehrung",
  "probetraining",
  "probetraining_zeit",
  "probetraining_klasse",
  "probetraining_klasse_name",
  "probetraining_benutzer",
  "probetraining_anwesend",
  "ergebnis_probetraining",
  "status",
  "text",
  "werbung",
  "werbung_bezeichnung"
] as const;

function zObject(
  responseData: unknown = {},
  capture: (request: HttpRequestOptionsWithUrl) => void = () => undefined
): ZObject {
  let requested = false;
  return {
    request: async (request: HttpRequestOptionsWithUrl) => {
      if (requested) {
        throw new Error("Unerwartete zusätzliche Testanfrage.");
      }
      requested = true;
      capture(request);
      return {
        data: responseData,
        status: 200,
        throwForStatus: () => undefined
      };
    },
    errors: {
      Error,
      ThrottledError: Error
    }
  } as unknown as ZObject;
}

function snapshotRecord(
  id: string = "a".repeat(64),
  sourceId = "12345"
): Record<string, unknown> {
  return {
    id,
    area: "interessenten_details",
    source_id: sourceId,
    content_hash: "b".repeat(64),
    vorname: "Beispiel"
  };
}

function hookTarget(path: string): string {
  return ["https://hooks.", "zapier.com/hooks/standard/", path].join("");
}

describe("lesender MATOOL-Webhook-Trigger", () => {
  it("behält den alten Trigger verborgen und exportiert den robusten Hook als v2", () => {
    expect(Object.keys(app.triggers ?? {})).toEqual([
      "matool_record",
      "matool_record_v2",
      "matool_prospect_record_v1",
      "matool_member_record_v1",
      "matool_ex_member_record_v1",
      "matool_checkin_record_v1",
      "matool_graduierung_record_v1"
    ]);
    expect(app.triggers?.matool_record?.display.hidden).toBe(true);
    expect(app.triggers?.matool_record?.operation.type).toBe("polling");
    expect(app.triggers?.matool_record_v2?.operation.type).toBe("hook");
    expect(Object.keys(app.creates ?? {})).toEqual([]);
    expect(Object.keys(app.searches ?? {})).toEqual([]);
  });

  it("begrenzt den verborgenen Legacy-Poll auf genau eine Seite mit 100 Datensätzen", async () => {
    const requests: string[] = [];
    const records = await performLegacy(
      zObject(
        {
          area: "interessenten_details",
          records: [snapshotRecord("a".repeat(64), "42")]
        },
        (request) => requests.push(request.url)
      ),
      {
        inputData: { area: "interessenten_details" }
      } as unknown as Parameters<typeof performLegacy>[1]
    );

    expect(requests).toEqual([
      "https://middleware.example.invalid/api/zapier/v1/snapshots?area=interessenten_details&limit=100"
    ]);
    expect(records[0]?.id).toBe(
      `interessenten_details:42:${"b".repeat(16)}`
    );
  });

  it("verlangt ausschließlich den Middleware-Service-Token", () => {
    expect(authentication.fields.map((field) => field.key)).toEqual([
      "service_token"
    ]);
  });

  it("bietet Interessenten-Details als eigenen Datenbereich an", () => {
    expect(SNAPSHOT_AREA_CHOICES.interessenten_details).toBe(
      "Interessenten-Details"
    );
  });

  it("bietet einen festen, datenschutzkonformen Interessenten-Trigger an", () => {
    expect(matoolProspectRecord.key).toBe("matool_prospect_record_v1");
    expect(matoolProspectRecord.operation.type).toBe("hook");
    expect(matoolProspectRecord.operation.sample).toMatchObject({
      area: "interessenten_details",
      vorname: "Beispiel"
    });
    expect(SNAPSHOT_AREA_CHOICES.schueler_details).toBe(
      "Mitglieder-Details (minimiert)"
    );
    expect(SNAPSHOT_AREA_CHOICES.checkin).toBe("Check-ins");
  });

  it("bietet einen festen, minimierten Mitglieder-Trigger an", () => {
    expect(matoolMemberRecord.key).toBe("matool_member_record_v1");
    expect(matoolMemberRecord.operation.type).toBe("hook");
    expect(matoolMemberRecord.operation.sample).toMatchObject({
      area: "schueler_details",
      vertragid: "synthetic-contract-id"
    });
    expect(matoolMemberRecord.operation.sample).not.toHaveProperty("iban");
    expect(matoolMemberRecord.operation.sample).not.toHaveProperty("bic");
  });

  it("bietet einen festen Trigger fuer abgeschlossene Kuendigungen an", () => {
    expect(matoolExMemberRecord.key).toBe("matool_ex_member_record_v1");
    expect(matoolExMemberRecord.operation.type).toBe("hook");
    expect(matoolExMemberRecord.operation.sample).toMatchObject({
      area: "schueler_ex",
      name: "Ehemalig",
      vorname: "Beispiel"
    });
    expect(SNAPSHOT_AREA_CHOICES.schueler_ex).toBe(
      "Ehemalige Mitglieder (Kündigung abgeschlossen)"
    );
  });

  it("bietet feste Trigger für Check-ins und Prüfungen an", () => {
    expect(matoolCheckinRecord.operation.sample).toMatchObject({
      area: "checkin",
      klasse_id: "1340",
      mitglied_id: "67890"
    });
    expect(matoolGraduierungRecord.operation.sample).toMatchObject({
      area: "graduierungen",
      graduierung_id: "15359",
      storniert: false
    });
    expect(SNAPSHOT_AREA_CHOICES.graduierungen).toBe(
      "Prüfungen / Graduierungen"
    );
  });

  it("abonniert beim Ex-Mitglied-Trigger nur den abgeschlossenen Kuendigungsbereich", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const operation = matoolExMemberRecord.operation;
    if (operation.type !== "hook") {
      throw new Error("Der Ex-Mitglied-Trigger muss ein REST Hook sein.");
    }
    const performSubscribe = operation.performSubscribe;
    if (typeof performSubscribe !== "function") {
      throw new Error("Der Ex-Mitglied-Trigger muss abonnierbar sein.");
    }

    await performSubscribe(
      zObject({ id: "subscription-ex-member" }, (request) => {
        captured = request;
      }),
      {
        inputData: { only_changed: true },
        targetUrl: hookTarget("ex-member/abc/")
      } as unknown as Parameters<typeof performSubscribe>[1]
    );

    expect(captured).toMatchObject({
      body: {
        area: "schueler_ex",
        only_changed: true,
        target_url: hookTarget("ex-member/abc/")
      },
      method: "POST",
      url: "https://middleware.example.invalid/api/zapier/v1/snapshot-subscriptions"
    });
  });

  it("abonniert beim festen Interessenten-Trigger immer nur den Detailbereich", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const operation = matoolProspectRecord.operation;
    if (operation.type !== "hook") {
      throw new Error("Der Interessenten-Trigger muss ein REST Hook sein.");
    }
    const performSubscribe = operation.performSubscribe;
    if (typeof performSubscribe !== "function") {
      throw new Error("Der Interessenten-Trigger muss abonnierbar sein.");
    }
    expect(operation.inputFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "only_new",
          label: "Nur neue Interessenten"
        })
      ])
    );

    const result = await performSubscribe(
      zObject({ id: "subscription-prospect" }, (request) => {
        captured = request;
      }),
      {
        inputData: { only_changed: true, only_new: true },
        targetUrl: hookTarget("prospect/abc/")
      } as unknown as Parameters<typeof performSubscribe>[1]
    );

    expect(result).toEqual({ id: "subscription-prospect" });
    expect(captured).toMatchObject({
      body: {
        area: "interessenten_details",
        only_changed: false,
        only_new: true,
        target_url: hookTarget("prospect/abc/")
      },
      method: "POST",
      url: "https://middleware.example.invalid/api/zapier/v1/snapshot-subscriptions"
    });
  });

  it("abonniert den Mitglieder-Trigger auf Wunsch ausschließlich für neue Mitglieder", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const operation = matoolMemberRecord.operation;
    if (operation.type !== "hook" || typeof operation.performSubscribe !== "function") {
      throw new Error("Der Mitglieder-Trigger muss abonnierbar sein.");
    }

    await operation.performSubscribe(
      zObject({ id: "subscription-new-member" }, (request) => {
        captured = request;
      }),
      {
        inputData: { only_changed: true, only_new: true },
        targetUrl: hookTarget("member/new/")
      } as unknown as Parameters<typeof operation.performSubscribe>[1]
    );

    expect(captured).toMatchObject({
      body: {
        area: "schueler_details",
        only_changed: false,
        only_new: true,
        target_url: hookTarget("member/new/")
      }
    });
  });

  it("liefert alle 34 Interessenten-Detailfelder als synthetisches Mapping-Beispiel", () => {
    expect(detailKeys).toHaveLength(34);
    for (const key of detailKeys) {
      expect(sample).toHaveProperty(key);
    }
    expect(sample.id).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(sample)).not.toContain("@kwonro");
  });

  it.each([true, "true"])(
    "registriert only_changed=%s mit Zapier-Zieladresse bei der Middleware",
    async (onlyChanged) => {
      let captured: HttpRequestOptionsWithUrl | undefined;
      const result = await performSubscribe(
        zObject({ id: "subscription-123" }, (request) => {
          captured = request;
        }),
        {
          inputData: {
            area: "interessenten_details",
            only_changed: onlyChanged
          },
          targetUrl: hookTarget("123/abc/")
        } as unknown as Parameters<typeof performSubscribe>[1]
      );

      expect(result).toEqual({ id: "subscription-123" });
      expect(captured).toMatchObject({
        method: "POST",
        url: "https://middleware.example.invalid/api/zapier/v1/snapshot-subscriptions",
        body: {
          target_url: hookTarget("123/abc/"),
          area: "interessenten_details",
          only_changed: true
        }
      });
    }
  );

  it("registriert standardmäßig neue und geänderte Datensätze", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    await performSubscribe(
      zObject({ id: "subscription-456" }, (request) => {
        captured = request;
      }),
      {
        inputData: { area: "interessenten_details" },
        targetUrl: hookTarget("456/def/")
      } as unknown as Parameters<typeof performSubscribe>[1]
    );

    expect(captured?.body).toMatchObject({ only_changed: false });
  });

  it("lehnt eine Subscription-Antwort ohne ID ab", async () => {
    await expect(
      performSubscribe(zObject({}), {
        inputData: { area: "interessenten_details" },
        targetUrl: hookTarget("123/abc/")
      } as unknown as Parameters<typeof performSubscribe>[1])
    ).rejects.toThrow(/Subscription-ID/u);
  });

  it("meldet eine Subscription mit der gespeicherten ID wieder ab", async () => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const result = await performUnsubscribe(
      zObject({ disabled: true }, (request) => {
        captured = request;
      }),
      {
        inputData: { area: "interessenten_details" },
        subscribeData: { id: "subscription/123" }
      } as unknown as Parameters<typeof performUnsubscribe>[1]
    );

    expect(result).toEqual({ id: "subscription/123" });
    expect(captured).toMatchObject({
      method: "DELETE",
      url: "https://middleware.example.invalid/api/zapier/v1/snapshot-subscriptions/subscription%2F123"
    });
  });

  it("übernimmt die eindeutige technische ID eines einzelnen Hooks unverändert", async () => {
    const backendId = "c".repeat(64);
    const records = await perform(zObject(), {
      inputData: { area: "interessenten_details" },
      cleanedRequest: snapshotRecord(backendId, "67890")
    } as unknown as Parameters<typeof perform>[1]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: backendId,
      area: "interessenten_details",
      source_id: "67890",
      matool_id: "67890",
      content_hash: "b".repeat(64)
    });
  });

  it("akzeptiert eine Hook-Liste und erhält Reihenfolge und IDs", async () => {
    const firstId = "d".repeat(64);
    const secondId = "e".repeat(64);
    const records = await perform(zObject(), {
      inputData: { area: "interessenten_details" },
      cleanedRequest: [
        snapshotRecord(firstId, "100"),
        snapshotRecord(secondId, "101")
      ]
    } as unknown as Parameters<typeof perform>[1]);

    expect(records.map((record) => record.id)).toEqual([firstId, secondId]);
  });

  it("verwirft Hook-Datensätze mit falschem Bereich", async () => {
    await expect(
      perform(zObject(), {
        inputData: { area: "interessenten_details" },
        cleanedRequest: {
          ...snapshotRecord(),
          area: "schueler"
        }
      } as unknown as Parameters<typeof perform>[1])
    ).rejects.toThrow(/keine gültige Datensatzliste/u);
  });

  it("lädt für den Zap-Test genau eine Seite mit höchstens drei Beispielen", async () => {
    const requests: string[] = [];
    const records = await performList(
      zObject(
        {
          area: "interessenten_details",
          count: 1,
          next_cursor: "300",
          records: [snapshotRecord("f".repeat(64), "25")]
        },
        (request) => requests.push(request.url)
      ),
      {
        inputData: { area: "interessenten_details" }
      } as unknown as Parameters<typeof performList>[1]
    );

    expect(records).toHaveLength(1);
    expect(requests).toEqual([
      "https://middleware.example.invalid/api/zapier/v1/snapshots?area=interessenten_details&limit=3"
    ]);
  });

  it("filtert auch beim Zap-Test only_changed vor dem Limit", async () => {
    let requestedUrl = "";
    await performList(
      zObject(
        {
          area: "interessenten_details",
          records: [snapshotRecord()]
        },
        (request) => {
          requestedUrl = request.url;
        }
      ),
      {
        inputData: {
          area: "interessenten_details",
          only_changed: "true"
        }
      } as unknown as Parameters<typeof performList>[1]
    );

    expect(requestedUrl).toBe(
      "https://middleware.example.invalid/api/zapier/v1/snapshots?area=interessenten_details&limit=3&only_changed=true"
    );
  });

  it("filtert beim Zap-Test ausschließlich neue Datensätze vor dem Limit", async () => {
    let requestedUrl = "";
    await performList(
      zObject(
        {
          area: "interessenten_details",
          records: [snapshotRecord()]
        },
        (request) => {
          requestedUrl = request.url;
        }
      ),
      {
        inputData: {
          area: "interessenten_details",
          only_new: "true"
        }
      } as unknown as Parameters<typeof performList>[1]
    );

    expect(requestedUrl).toBe(
      "https://middleware.example.invalid/api/zapier/v1/snapshots?area=interessenten_details&limit=3&only_new=true"
    );
  });

  it("verwirft Testantworten ohne gültige Quell-ID und Inhaltshash", async () => {
    await expect(
      performList(
        zObject({
          area: "interessenten_details",
          records: [{ id: "nicht-ausreichend" }]
        }),
        {
          inputData: { area: "interessenten_details" }
        } as unknown as Parameters<typeof performList>[1]
      )
    ).rejects.toThrow(/keine gültige Datensatzliste/u);
  });

  it("weist unbekannte Bereiche ab, bevor eine Anfrage gesendet wird", async () => {
    let requested = false;
    await expect(
      performList(
        zObject({}, () => {
          requested = true;
        }),
        {
          inputData: { area: "nicht-erlaubt" }
        } as unknown as Parameters<typeof performList>[1]
      )
    ).rejects.toThrow(/ungültig/u);
    expect(requested).toBe(false);
  });
});
