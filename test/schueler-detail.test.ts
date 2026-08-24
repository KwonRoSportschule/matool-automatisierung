import { describe, expect, it } from "vitest";

import {
  MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS,
  parseSchuelerDetailResponse
} from "../src/matool/schueler-detail";

const encoder = new TextEncoder();
const EXPECTED_ID = "700001";

function completeRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS.map((field, index) => [
        field,
        `synthetic-${index}`
      ])
    ),
    schueler_nr: EXPECTED_ID,
    ...overrides
  };
}

function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function expectSchemaMismatch(body: Uint8Array, expectedId = EXPECTED_ID) {
  expect(() => parseSchuelerDetailResponse(body, expectedId)).toThrowError(
    expect.objectContaining({
      code: "matool_schueler_detail_schema_mismatch",
      status: 502
    })
  );
}

describe("Schueler-Detailparser", () => {
  it("akzeptiert genau einen Datensatz als Array oder Objekt-Map", () => {
    const arrayResult = parseSchuelerDetailResponse(
      encodeJson([completeRecord()]),
      EXPECTED_ID
    );
    const mapResult = parseSchuelerDetailResponse(
      encodeJson({ syntheticKey: completeRecord() }),
      EXPECTED_ID
    );

    expect(arrayResult).toEqual(mapResult);
    expect(arrayResult.sourceId).toBe(EXPECTED_ID);
    expect(Object.keys(arrayResult.payload).sort()).toEqual(
      [...MATOOL_SCHUELER_DETAIL_PAYLOAD_FIELDS].sort()
    );
  });

  it("bewahrt Skalare und null unveraendert sowie komplexe Werte kanonisch", () => {
    const result = parseSchuelerDetailResponse(
      encodeJson([
        completeRecord({
          abschluss: null,
          abweichenderEinzug: true,
          anmeldegebuehr: 123.5,
          anrede: "  Synthetisch  ",
          kategorienliste: { z: 2, a: { d: 4, b: 3 } },
          klassenliste: [{ z: 2, a: 1 }, "synthetic", null]
        })
      ]),
      EXPECTED_ID
    );

    expect(result.payload.abschluss).toBeNull();
    expect(result.payload.abweichenderEinzug).toBe(true);
    expect(result.payload.anmeldegebuehr).toBe(123.5);
    expect(result.payload.anrede).toBe("  Synthetisch  ");
    expect(result.payload.kategorienliste).toBe(
      '{"a":{"b":3,"d":4},"z":2}'
    );
    expect(result.payload.klassenliste).toBe(
      '[{"a":1,"z":2},"synthetic",null]'
    );
  });

  it("verwirft eine nichtnumerische oder fremde Schueler-ID", () => {
    expectSchemaMismatch(
      encodeJson([completeRecord({ schueler_nr: "not-numeric" })])
    );
    expectSchemaMismatch(
      encodeJson([completeRecord({ schueler_nr: "700002" })])
    );
    expectSchemaMismatch(encodeJson([completeRecord()]), "not-numeric");
  });

  it("verwirft fehlende und zusaetzliche Top-Level-Felder", () => {
    const missing = completeRecord();
    delete missing.email;
    expectSchemaMismatch(encodeJson([missing]));
    expectSchemaMismatch(
      encodeJson([completeRecord({ unexpected_private_field: "synthetic" })])
    );
  });

  it("verwirft leere und mehrdeutige Array- oder Objekt-Maps", () => {
    expectSchemaMismatch(encodeJson([]));
    expectSchemaMismatch(encodeJson({}));
    expectSchemaMismatch(encodeJson(completeRecord()));
    expectSchemaMismatch(encodeJson([completeRecord(), completeRecord()]));
    expectSchemaMismatch(
      encodeJson({ first: completeRecord(), second: completeRecord() })
    );
  });

  it("verwirft fehlerhaftes JSON und uebergrosse Antworten", () => {
    expectSchemaMismatch(encoder.encode("{not-json"));
    expectSchemaMismatch(
      encodeJson([completeRecord({ memo: "x".repeat(256_001) })])
    );
    expectSchemaMismatch(
      encodeJson([
        completeRecord({ klassenliste: ["x".repeat(256_001)] })
      ])
    );
    expectSchemaMismatch(
      encodeJson([
        completeRecord({
          beruf: "x".repeat(256_000),
          memo: "y".repeat(256_000)
        })
      ])
    );
    expectSchemaMismatch(new Uint8Array(2_000_001));
  });
});
