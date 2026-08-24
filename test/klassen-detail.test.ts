import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/core/crypto";
import {
  MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS,
  MATOOL_KLASSEN_SCHUELER_FIELDS,
  parseKlassenDetailResponse
} from "../src/matool/klassen-detail";

const encoder = new TextEncoder();
const EXPECTED_ID = "700001";

function schueler(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    alter: 12,
    austritt: null,
    bildlink: "https://example.invalid/synthetic.png",
    nachname: "Nachname",
    schueler_nr_schulintern: "SYNTHETIC-INTERNAL-17",
    vorname: "Vorname",
    ...overrides
  };
}

function completeKlasse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    alter_ende: "99",
    alter_start: "1",
    benutzer: "1000",
    beschreibung: "Synthetic class",
    bildDa: null,
    endzeit_h: "20",
    endzeit_m: "00",
    freiklasse: "0",
    id: EXPECTED_ID,
    id_schulintern: "1",
    kapazitaet: "20",
    klassenende: "2030-12-31",
    klassenfarbe: "abcdef",
    klassenstart: "2026-01-01",
    kurzname: "Synthetic",
    liveLink: "https://example.invalid/live/synthetic",
    online: "0",
    probetraining_kontingent: "2",
    raum: "1",
    schueler_liste_sms: "Synthetic SMS list",
    schuelerliste: [schueler()],
    schule: "1",
    sms30: "0",
    sms30Text: "Synthetic SMS text",
    sparte: "1",
    startzeit_h: "19",
    startzeit_m: "00",
    teilnehmerMax: "20",
    wochentag: "1",
    ...overrides
  };
}

function parse(value: unknown, expectedId = EXPECTED_ID) {
  return parseKlassenDetailResponse(
    encoder.encode(JSON.stringify(value)),
    expectedId
  );
}

function expectSchemaMismatch(run: () => unknown): void {
  expect(run).toThrowError(
    expect.objectContaining({
      code: "matool_klassen_detail_schema_mismatch",
      status: 502
    })
  );
}

describe("Klassen-Detailparser", () => {
  it("exportiert die vollstaendige bestaetigte Klassen- und Schueler-Feldmenge", () => {
    expect(MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS).toHaveLength(29);
    expect(MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS).toEqual(
      expect.arrayContaining([
        "liveLink",
        "schueler_liste_sms",
        "schuelerliste",
        "sms30Text"
      ])
    );
    expect(MATOOL_KLASSEN_SCHUELER_FIELDS).toEqual([
      "alter",
      "austritt",
      "bildlink",
      "nachname",
      "schueler_nr_schulintern",
      "vorname"
    ]);
  });

  it("bewahrt alle Klassenfelder und die kanonische Schuelerliste vollstaendig", () => {
    const students = [
      schueler(),
      schueler({
        alter: "13",
        austritt: "",
        bildlink: "",
        nachname: "Zweiter",
        schueler_nr_schulintern: 18,
        vorname: "Datensatz"
      })
    ];
    const source = completeKlasse({ schuelerliste: students });

    const result = parse([source]);

    expect(result.sourceId).toBe(EXPECTED_ID);
    expect(Object.keys(result.payload)).toEqual([
      ...MATOOL_KLASSEN_DETAIL_PAYLOAD_FIELDS
    ]);
    expect(result.payload).toMatchObject({
      liveLink: source.liveLink,
      schueler_liste_sms: source.schueler_liste_sms,
      sms30Text: source.sms30Text
    });
    expect(result.payload.schuelerliste).toBe(canonicalJson(students));
  });

  it("akzeptiert eine leere Schuelerliste und null in den bestaetigten Klassenfeldern", () => {
    expect(
      parse([
        completeKlasse({
          beschreibung: null,
          bildDa: null,
          schuelerliste: []
        })
      ])
    ).toMatchObject({
      payload: {
        beschreibung: null,
        bildDa: null,
        schuelerliste: "[]"
      },
      sourceId: EXPECTED_ID
    });
  });

  it("verwirft fehlende, zusaetzliche und typfalsche Klassenfelder", () => {
    const missing = completeKlasse();
    delete missing.liveLink;

    expectSchemaMismatch(() => parse([missing]));
    expectSchemaMismatch(() =>
      parse([completeKlasse({ nicht_bestaetigt: "synthetic" })])
    );
    expectSchemaMismatch(() =>
      parse([completeKlasse({ beschreibung: { nested: true } })])
    );
    expectSchemaMismatch(() =>
      parse([completeKlasse({ sms30Text: null })])
    );
  });

  it("verwirft leere, mehrfache, gemappte und direkte Antworten", () => {
    expectSchemaMismatch(() => parse([]));
    expectSchemaMismatch(() =>
      parse([completeKlasse(), completeKlasse()])
    );
    expectSchemaMismatch(() => parse({ klasse: completeKlasse() }));
    expectSchemaMismatch(() => parse(completeKlasse()));
    expectSchemaMismatch(() => parse([null]));
  });

  it("verwirft nichtnumerische, typfalsche und abweichende Klassen-IDs", () => {
    expectSchemaMismatch(() =>
      parse([completeKlasse({ id: "klasse-700001" })])
    );
    expectSchemaMismatch(() => parse([completeKlasse({ id: 700001 })]));
    expectSchemaMismatch(() => parse([completeKlasse()], "700002"));
    expectSchemaMismatch(() => parse([completeKlasse()], "ungueltig"));
  });

  it("verwirft unvollstaendige, erweiterte und komplexe Schueler-Eintraege", () => {
    const missing = schueler();
    delete missing.austritt;

    expectSchemaMismatch(() =>
      parse([completeKlasse({ schuelerliste: [missing] })])
    );
    expectSchemaMismatch(() =>
      parse([
        completeKlasse({
          schuelerliste: [schueler({ nicht_bestaetigt: "synthetic" })]
        })
      ])
    );
    expectSchemaMismatch(() =>
      parse([
        completeKlasse({
          schuelerliste: [schueler({ bildlink: { nested: true } })]
        })
      ])
    );
    expectSchemaMismatch(() =>
      parse([completeKlasse({ schuelerliste: ["kein Objekt"] })])
    );
    expectSchemaMismatch(() =>
      parse([completeKlasse({ schuelerliste: null })])
    );
  });

  it("verwirft fehlerhaftes JSON und Antworten ausserhalb der Schutzgrenzen", () => {
    expectSchemaMismatch(() =>
      parseKlassenDetailResponse(encoder.encode("{ungueltig"), EXPECTED_ID)
    );
    expectSchemaMismatch(() =>
      parseKlassenDetailResponse(new Uint8Array(2_000_001), EXPECTED_ID)
    );
    expectSchemaMismatch(() =>
      parse([
        completeKlasse({ beschreibung: "x".repeat(256_001) })
      ])
    );
  });
});
