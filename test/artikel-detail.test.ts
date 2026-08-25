import { describe, expect, it } from "vitest";
import {
  MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS,
  parseArtikelDetailResponse
} from "../src/matool/artikel-detail";

const encoder = new TextEncoder();

function completeArtikel(overrides: Record<string, unknown> = {}) {
  return {
    artikel_nr: "ART-17",
    beschreibung: "Synthetische Beschreibung",
    bezeichnung: "Synthetischer Artikel",
    brutto_vk: 19.9,
    id: "700001",
    lieferant: null,
    memo: "",
    mwstsatz: 19,
    netto_ek: 8.5,
    soll_bestand: true,
    ...overrides
  };
}

function parse(value: unknown, expectedId = "700001") {
  return parseArtikelDetailResponse(
    encoder.encode(JSON.stringify(value)),
    expectedId
  );
}

function expectSchemaMismatch(run: () => unknown): void {
  expect(run).toThrowError(
    expect.objectContaining({
      code: "matool_artikel_detail_schema_mismatch",
      status: 502
    })
  );
}

describe("parseArtikelDetailResponse", () => {
  it("exportiert die vollstaendige bestaetigte Feld-Allowlist", () => {
    expect(MATOOL_ARTIKEL_DETAIL_PAYLOAD_FIELDS).toEqual([
      "artikel_nr",
      "beschreibung",
      "bezeichnung",
      "brutto_vk",
      "id",
      "lieferant",
      "memo",
      "mwstsatz",
      "netto_ek",
      "soll_bestand"
    ]);
  });

  it("akzeptiert genau einen Array-Datensatz und erhaelt Skalare und null", () => {
    const source = completeArtikel();

    expect(parse([source])).toEqual({
      payload: source,
      sourceId: "700001"
    });
  });

  it("akzeptiert genau einen Datensatz in einer Objekt-Map", () => {
    const source = completeArtikel({ id: 700001 });

    expect(parse({ artikel_700001: source })).toEqual({
      payload: source,
      sourceId: "700001"
    });
  });

  it("verwirft fehlende und zusaetzliche Felder", () => {
    const missing = completeArtikel();
    delete (missing as Partial<typeof missing>).memo;

    expectSchemaMismatch(() => parse([missing]));
    expectSchemaMismatch(() =>
      parse([{ ...completeArtikel(), unbekannt: "nicht freigegeben" }])
    );
  });

  it("verwirft leere, mehrfache und direkte Top-Level-Datensaetze", () => {
    expectSchemaMismatch(() => parse([]));
    expectSchemaMismatch(() =>
      parse([completeArtikel(), completeArtikel({ id: "700002" })])
    );
    expectSchemaMismatch(() => parse({}));
    expectSchemaMismatch(() =>
      parse({ erster: completeArtikel(), zweiter: completeArtikel() })
    );
    expectSchemaMismatch(() => parse(completeArtikel()));
  });

  it("verwirft ungueltiges JSON sowie verschachtelte Werte", () => {
    expectSchemaMismatch(() =>
      parseArtikelDetailResponse(encoder.encode("{ungueltig"), "700001")
    );
    expectSchemaMismatch(() =>
      parse([completeArtikel({ memo: { privat: "verschachtelt" } })])
    );
    expectSchemaMismatch(() =>
      parse([completeArtikel({ beschreibung: ["verschachtelt"] })])
    );
  });

  it("verwirft zu grosse Antworten und Feldwerte", () => {
    expectSchemaMismatch(() =>
      parse([completeArtikel({ memo: "x".repeat(2_001) })])
    );
    expectSchemaMismatch(() =>
      parseArtikelDetailResponse(new Uint8Array(64_001), "700001")
    );
  });

  it("verwirft nichtnumerische, unsichere und abweichende IDs", () => {
    expectSchemaMismatch(() =>
      parse([completeArtikel({ id: "artikel-700001" })])
    );
    expectSchemaMismatch(() =>
      parse([completeArtikel({ id: Number.MAX_SAFE_INTEGER + 1 })])
    );
    expectSchemaMismatch(() => parse([completeArtikel()], "700002"));
    expectSchemaMismatch(() => parse([completeArtikel()], "ungueltig"));
  });
});
