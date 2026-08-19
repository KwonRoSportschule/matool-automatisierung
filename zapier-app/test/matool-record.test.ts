import { describe, expect, it } from "vitest";
import type {
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import app from "../src/index.js";
import authentication from "../src/authentication.js";
import { performLegacy } from "../src/triggers/matool-record-legacy.js";
import {
  perform,
  performList,
  performSubscribe,
  performUnsubscribe,
  sample,
  SNAPSHOT_AREA_CHOICES
} from "../src/triggers/matool-record.js";

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
      "matool_record_v2"
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
