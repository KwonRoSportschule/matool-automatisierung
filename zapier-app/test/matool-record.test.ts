import { describe, expect, it } from "vitest";
import type {
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import app from "../src/index.js";
import authentication from "../src/authentication.js";
import {
  perform,
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
  responseData: Record<string, unknown>,
  capture: (request: HttpRequestOptionsWithUrl) => void = () => undefined
): ZObject {
  return {
    request: async (request: HttpRequestOptionsWithUrl) => {
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

describe("lesender MATOOL-Polling-Trigger", () => {
  it("exportiert nur einen Trigger und keine Schreibaktion", () => {
    expect(Object.keys(app.triggers ?? {})).toEqual(["matool_record"]);
    expect(Object.keys(app.creates ?? {})).toEqual([]);
    expect(Object.keys(app.searches ?? {})).toEqual([]);
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
    expect(JSON.stringify(sample)).not.toContain("@kwonro");
  });

  it.each([true, "true"])(
    "fragt bei only_changed=%s maximal 100 zuletzt wirklich geänderte Datensätze an",
    async (onlyChanged) => {
    let captured: HttpRequestOptionsWithUrl | undefined;
    const contentHash = "a".repeat(64);
    const bundle = {
      inputData: {
        area: "interessenten_details",
        only_changed: onlyChanged
      }
    } as unknown as Parameters<typeof perform>[1];

    await perform(
      zObject(
        {
          area: "interessenten_details",
          count: 1,
          records: [
            {
              id: "12345",
              source_id: "12345",
              content_hash: contentHash,
              vorname: "Beispiel"
            }
          ]
        },
        (request) => {
          captured = request;
        }
      ),
      bundle
    );

    expect(captured?.url).toBe(
      "https://middleware.example.invalid/api/zapier/v1/snapshots?area=interessenten_details&limit=100&only_changed=true"
    );
    }
  );

  it("schützt die technische Zapier-ID vor gleichnamigen MATOOL-Payloadfeldern", async () => {
    const contentHash = "b".repeat(64);
    const records = await perform(
      zObject({
        area: "interessenten_details",
        count: 1,
        records: [
          {
            id: "payload-will-not-win",
            area: "payload-will-not-win",
            source_id: "67890",
            content_hash: contentHash,
            name: "Beispiel"
          }
        ]
      }),
      {
        inputData: {
          area: "interessenten_details",
          only_changed: false
        }
      } as unknown as Parameters<typeof perform>[1]
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: `interessenten_details:67890:${contentHash.slice(0, 16)}`,
      area: "interessenten_details",
      source_id: "67890",
      matool_id: "67890",
      content_hash: contentHash
    });
  });

  it("verwirft Antworten ohne gültige Quell-ID und Inhaltshash", async () => {
    await expect(
      perform(
        zObject({
          area: "interessenten_details",
          count: 1,
          records: [{ id: "nicht-ausreichend" }]
        }),
        {
          inputData: { area: "interessenten_details" }
        } as unknown as Parameters<typeof perform>[1]
      )
    ).rejects.toThrow(/keine gültige Datensatzliste/u);
  });

  it("weist unbekannte Bereiche ab, bevor eine Anfrage gesendet wird", async () => {
    let requested = false;
    await expect(
      perform(
        zObject({}, () => {
          requested = true;
        }),
        {
          inputData: { area: "nicht-erlaubt" }
        } as unknown as Parameters<typeof perform>[1]
      )
    ).rejects.toThrow(/ungültig/u);
    expect(requested).toBe(false);
  });
});
