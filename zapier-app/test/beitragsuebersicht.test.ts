import { describe, expect, it } from "vitest";
import type {
  Bundle,
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import app from "../src/index.js";
import beitragsuebersicht, {
  perform,
  sample
} from "../src/creates/beitragsuebersicht.js";

// Synthetische Antwort der Middleware.
function antwort(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { xml_datei: _datei, ...felder } = sample;
  return {
    ...felder,
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n<beitragsuebersicht version="1"/>\n',
    ...overrides
  };
}

interface Aufzeichnung {
  requests: HttpRequestOptionsWithUrl[];
  stashed: Array<{ contentType: unknown; filename: unknown; inhalt: string; laenge: unknown }>;
}

function zObject(responseData: unknown, aufzeichnung: Aufzeichnung): ZObject {
  class ZapierError extends Error {
    readonly code: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    request: async (request: HttpRequestOptionsWithUrl) => {
      aufzeichnung.requests.push(request);
      return { data: responseData, status: 200, throwForStatus: () => undefined };
    },
    stashFile: async (
      input: Buffer,
      laenge: unknown,
      filename: unknown,
      contentType: unknown
    ) => {
      aufzeichnung.stashed.push({
        contentType,
        filename,
        inhalt: input.toString("utf8"),
        laenge
      });
      return "https://zapier.example.invalid/stash/beitragsuebersicht.xml";
    },
    errors: { Error: ZapierError }
  } as unknown as ZObject;
}

function bundle(inputData: Record<string, unknown>): Bundle {
  return { authData: {}, inputData } as unknown as Bundle;
}

describe("Aktion Beitragsübersicht erstellen", () => {
  it("ist in der App registriert", () => {
    expect(app.creates?.[beitragsuebersicht.key]).toBe(beitragsuebersicht);
  });

  it("ruft die Middleware mit Stichtag auf und legt die XML als Datei ab", async () => {
    const aufzeichnung: Aufzeichnung = { requests: [], stashed: [] };
    const ergebnis = (await perform(
      zObject(antwort(), aufzeichnung),
      bundle({ stichtag: "2026-10-01", bei_unvollstaendigen_daten: "abbrechen" }) as never
    )) as Record<string, unknown>;

    expect(aufzeichnung.requests[0]?.url).toBe(
      "https://middleware.example.invalid/api/zapier/v1/beitraege?stichtag=2026-10-01"
    );
    expect(aufzeichnung.stashed).toEqual([
      {
        contentType: "application/xml",
        filename: "beitragsuebersicht_2026-10-01.xml",
        inhalt: expect.stringContaining("<beitragsuebersicht"),
        laenge: expect.any(Number)
      }
    ]);
    expect(ergebnis).toMatchObject({
      monatssumme: "99.40",
      vollstaendig: true,
      xml_datei: "https://zapier.example.invalid/stash/beitragsuebersicht.xml"
    });
    expect(ergebnis).not.toHaveProperty("xml");
  });

  it("fragt ohne Stichtag den heutigen Stand ab", async () => {
    const aufzeichnung: Aufzeichnung = { requests: [], stashed: [] };
    await perform(
      zObject(antwort(), aufzeichnung),
      bundle({ bei_unvollstaendigen_daten: "abbrechen" }) as never
    );
    expect(aufzeichnung.requests[0]?.url).toBe(
      "https://middleware.example.invalid/api/zapier/v1/beitraege"
    );
  });

  it("bricht bei unvollstaendigen Daten standardmaessig ab", async () => {
    const aufzeichnung: Aufzeichnung = { requests: [], stashed: [] };
    await expect(
      perform(
        zObject(
          antwort({ vollstaendig: false, anzahl_stammdaten_fehlen: 3 }),
          aufzeichnung
        ),
        bundle({ bei_unvollstaendigen_daten: "abbrechen" }) as never
      )
    ).rejects.toMatchObject({ code: "beitraege_unvollstaendig" });
    expect(aufzeichnung.stashed).toHaveLength(0);
  });

  it("erstellt auf Wunsch trotzdem", async () => {
    const aufzeichnung: Aufzeichnung = { requests: [], stashed: [] };
    const ergebnis = (await perform(
      zObject(antwort({ vollstaendig: false }), aufzeichnung),
      bundle({ bei_unvollstaendigen_daten: "trotzdem" }) as never
    )) as Record<string, unknown>;
    expect(ergebnis.vollstaendig).toBe(false);
    expect(aufzeichnung.stashed).toHaveLength(1);
  });

  it("lehnt ungueltige Stichtage und Antworten ab", async () => {
    const aufzeichnung: Aufzeichnung = { requests: [], stashed: [] };
    await expect(
      perform(zObject(antwort(), aufzeichnung), bundle({ stichtag: "01.10.2026" }) as never)
    ).rejects.toMatchObject({ code: "invalid_beitraege_stichtag" });
    expect(aufzeichnung.requests).toHaveLength(0);

    await expect(
      perform(
        zObject(antwort({ dateiname: "../boese.xml" }), aufzeichnung),
        bundle({}) as never
      )
    ).rejects.toMatchObject({ code: "invalid_beitraege_response" });
  });
});
