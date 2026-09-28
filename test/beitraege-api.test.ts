import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/worker";
import {
  ladeBeitragsStichtag,
  sichereBeitragsStichtag
} from "../src/worker/beitrags-archiv";
import { dataProtectionStatus } from "../src/worker/data-protection";
import type { Env } from "../src/worker/env";
import { handleScheduledInvocation } from "../src/worker/schedule";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

const serviceToken = "synthetic-service-token-at-least-32-characters";
const checkinToken = "synthetic-checkin-token-at-least-32-characters";

// Vollstaendig synthetisch. Die Stammdaten enthalten bewusst Bank- und
// Geburtsdaten, um zu belegen, dass sie die Beitragsuebersicht nie erreichen.
const IBAN_SENTINEL = "DE00SYNTHETIC0000000000";
const GEBURTSTAG_SENTINEL = "1900-01-01-SYNTHETIC";

async function dispatch(request: Request, runtimeEnv: Env = env): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, runtimeEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

async function seedMitglieder(
  optionen: { exMitglieder?: number; ohneNeuzugang?: boolean } = {}
): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM matool_snapshots WHERE area IN ('schueler', 'schueler_details', 'schueler_ex')"
  ).run();
  await env.DB.prepare("DELETE FROM beitrags_stichtage").run();
  const cipher = await storedPayloadCipher(env);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const liste = [
    { sourceId: "9100001", payload: { nr: "1", vorname: "Erika", name: "Beispiel", vertrag: "Erwachsene" } },
    { sourceId: "9100002", payload: { nr: "2", vorname: "Max", name: "Muster", vertrag: "Kinder" } },
    { sourceId: "9100003", payload: { nr: "3", vorname: "Ruth", name: "Ruhe", vertrag: "Erwachsene" } },
    { sourceId: "9100004", payload: { nr: "4", vorname: "Neu", name: "Zugang", vertrag: "Kinder" } }
  ].filter((eintrag) => !optionen.ohneNeuzugang || eintrag.sourceId !== "9100004");
  const ehemalige = Array.from({ length: optionen.exMitglieder ?? 0 }, (_, index) => ({
    sourceId: String(9200001 + index),
    payload: { nr: String(100 + index), vorname: "Ehemals", name: `Ex${index}`, vertrag: "Kinder" }
  }));
  const stammdaten = [
    {
      sourceId: "9100001",
      payload: {
        beitrag: "59,90",
        geburtstag: GEBURTSTAG_SENTINEL,
        iban: IBAN_SENTINEL,
        kundenart: "Mitglied",
        mitgliednr: "M-1",
        name: "Beispiel",
        schule: "273",
        spartenliste: '["Kickboxen"]',
        abweichenderEinzug: "15",
        vertragsbeginn: "2025-02-01",
        vname: "Erika",
        zahlungsperiode: "monatlich"
      }
    },
    {
      sourceId: "9100002",
      payload: {
        beitrag: "39,50",
        iban: IBAN_SENTINEL,
        kundenart: "Mitglied",
        mitgliednr: "M-2",
        name: "Muster",
        vertragsbeginn: "2019-03-07",
        vname: "Max",
        zahlungsperiode: "monatlich"
      }
    },
    {
      sourceId: "9100003",
      payload: {
        beitrag: "59,90",
        kundenart: "Stillgelegt",
        mitgliednr: "M-3",
        name: "Ruhe",
        vname: "Ruth",
        zahlungsperiode: "monatlich"
      }
    }
    // 9100004 hat noch keine Stammdaten.
  ];

  for (const [area, records] of [
    ["schueler", liste],
    ["schueler_details", stammdaten],
    ["schueler_ex", ehemalige]
  ] as const) {
    if (records.length === 0) {
      continue;
    }
    await persistMatoolSnapshotRun(
      env.DB,
      {
        allowedPayloadFields: [
          ...new Set(records.flatMap((record) => Object.keys(record.payload)))
        ],
        area,
        finishedAt: "2026-09-30T10:00:02.000Z",
        observedAt: "2026-09-30T10:00:01.000Z",
        records,
        runId: `beitraege_${area}_${suffix}`,
        startedAt: "2026-09-30T10:00:00.000Z"
      },
      cipher
    );
  }
}

function checkinRequest(path: string, token = checkinToken): Request {
  return new Request(`https://middleware.example.invalid${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function adminRequest(path: string): Request {
  return new Request(`http://127.0.0.1${path}`);
}

function zapierRequest(path: string, token = serviceToken): Request {
  return new Request(`https://middleware.example.invalid${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

beforeEach(async () => {
  await seedMitglieder();
});

describe("Beitragsuebersicht fuer Zapier", () => {
  it("summiert aktive Mitglieder und liefert XML ohne Bank- oder Geburtsdaten", async () => {
    const response = await dispatch(
      zapierRequest("/api/zapier/v1/beitraege?stichtag=2026-10-01")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(IBAN_SENTINEL);
    expect(text).not.toContain(GEBURTSTAG_SENTINEL);

    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "beitraege:2026-10-01",
      stichtag: "2026-10-01",
      dateiname: "beitragsuebersicht_2026-10-01.xml",
      betragsbezug: "monat",
      monatssumme: "99.40",
      monatssumme_cent: 9940,
      anzahl_mitglieder_gesamt: 4,
      anzahl_eingerechnet: 2,
      anzahl_stillgelegt: 1,
      anzahl_stammdaten_fehlen: 1,
      vollstaendig: false
    });
    expect(body.monatssumme_text).toMatch(/^99,40\s€$/u);
    expect(body.mitglieder).toEqual([
      expect.objectContaining({ nachname: "Beispiel", monatsbeitrag: "59.90", mitgliedsnummer: "M-1" }),
      expect.objectContaining({ nachname: "Muster", monatsbeitrag: "39.50" })
    ]);
    expect(body.nicht_eingerechnet).toEqual([
      expect.objectContaining({ matool_id: "9100004", grund: "stammdaten_fehlen" }),
      expect.objectContaining({ matool_id: "9100003", grund: "stillgelegt", detail: "kundenart: Stillgelegt" })
    ]);
    expect(body.xml).toEqual(expect.stringContaining("<monatssumme>99.40</monatssumme>"));
  });

  it("verlangt den Service-Token", async () => {
    const response = await dispatch(
      zapierRequest("/api/zapier/v1/beitraege", "falscher-token-der-lang-genug-ist-1234")
    );
    expect(response.status).toBe(403);
  });

  it("lehnt einen ungueltigen Stichtag ab", async () => {
    const response = await dispatch(
      zapierRequest("/api/zapier/v1/beitraege?stichtag=2026-02-30")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_beitraege_stichtag" }
    });
  });

  it("wendet konfigurierte Stilllegungsregeln an", async () => {
    const response = await dispatch(zapierRequest("/api/zapier/v1/beitraege"), {
      ...env,
      BEITRAEGE_STILLLEGUNG_FELDER: "vertrag",
      BEITRAEGE_STILLLEGUNG_MUSTER: "=Kinder"
    } as Env);
    const body = (await response.json()) as Record<string, unknown>;
    // Jetzt gilt der Kindervertrag als stillgelegt, "Stillgelegt" in der
    // Kundenart dagegen nicht mehr.
    expect(body).toMatchObject({
      monatssumme: "119.80",
      anzahl_stillgelegt: 2,
      anzahl_eingerechnet: 2
    });
  });

  it("meldet eine ungueltige Konfiguration statt falsch zu rechnen", async () => {
    const response = await dispatch(zapierRequest("/api/zapier/v1/beitraege"), {
      ...env,
      BEITRAEGE_BETRAGSBEZUG: "woche"
    } as Env);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "beitraege_config_invalid" }
    });
  });
});

describe("Beitragsuebersicht im Dashboard", () => {
  it("ist aus dem Hub entfernt und lebt in der Klassenauswertung", async () => {
    for (const path of ["/api/admin/v1/beitraege", "/api/admin/v1/beitraege.xml"]) {
      const response = await dispatch(adminRequest(path), {
        ...env,
        PUBLIC_DASHBOARD_PLAINTEXT: "true"
      } as Env);
      expect(response.status).toBe(404);
    }
  });
});

interface CheckinAntwort {
  mitglieder: Array<Record<string, unknown>>;
  nicht_eingerechnet: Array<Record<string, unknown>>;
  quelle: string;
  stichtag: string;
  zusammenfassung: Record<string, unknown>;
}

describe("Beitragsuebersicht fuer die Klassenauswertung", () => {
  it("liefert heute den Live-Stand mit Schule und Sparten, ohne Bank- oder Geburtsdaten", async () => {
    await seedMitglieder({ exMitglieder: 3 });
    const response = await dispatch(checkinRequest("/api/checkin/v1/beitraege"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(IBAN_SENTINEL);
    expect(text).not.toContain(GEBURTSTAG_SENTINEL);

    const body = JSON.parse(text) as CheckinAntwort;
    expect(body.quelle).toBe("live");
    expect(body.zusammenfassung).toMatchObject({
      monatssumme_cent: 9940,
      mitglieder_gesamt: 4,
      mit_beitrag: 2,
      stillgelegt: 1,
      stammdaten_fehlen: 1,
      ex_mitglieder: 3,
      vollstaendig: false
    });
    expect(body.mitglieder[0]).toMatchObject({
      nachname: "Beispiel",
      schule: "Rosenheim",
      sparten: ["Kickboxen"],
      monatsbeitrag_cent: 5990,
      einzugstag: 15,
      einzugsquelle: "abweichend"
    });
    expect(body.mitglieder[1]).toMatchObject({
      nachname: "Muster",
      einzugstag: 7,
      einzugsquelle: "vertragsbeginn"
    });
    expect(body.zusammenfassung).toMatchObject({
      einzug_nach_tag: [
        { tag: 7, cent: 3950, zahler: 1 },
        { tag: 15, cent: 5990, zahler: 1 }
      ],
      einzug_unklar: { cent: 0, zahler: 0 }
    });
    // Der ruhende Beitrag ist sichtbar, aber nicht in der Summe.
    expect(body.nicht_eingerechnet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matool_id: "9100003", grund: "stillgelegt", beitrag_cent: 5990 })
      ])
    );
  });

  it("zaehlt Ex-Mitglieder erst, wenn ihre Liste gelesen wurde", async () => {
    const response = await dispatch(checkinRequest("/api/checkin/v1/beitraege"));
    const body = (await response.json()) as CheckinAntwort;
    expect(body.zusammenfassung.ex_mitglieder).toBeNull();
  });

  it("verlangt den eigenen Token und nimmt den Zapier-Token nicht an", async () => {
    expect(
      (await dispatch(checkinRequest("/api/checkin/v1/beitraege", serviceToken))).status
    ).toBe(403);
    expect(
      (await dispatch(new Request("https://middleware.example.invalid/api/checkin/v1/beitraege"))).status
    ).toBe(403);
    const ohneToken = await dispatch(checkinRequest("/api/checkin/v1/beitraege"), {
      ...env,
      CHECKIN_SERVICE_TOKEN: ""
    } as Env);
    expect(ohneToken.status).toBe(503);
    // Der Check-in-Token oeffnet umgekehrt keine Zapier-Route.
    expect(
      (await dispatch(zapierRequest("/api/zapier/v1/beitraege", checkinToken))).status
    ).toBe(403);
  });

  it("lehnt Stichtage in der Zukunft und ungesicherte Tage ab", async () => {
    const zukunft = await dispatch(checkinRequest("/api/checkin/v1/beitraege?stichtag=2999-01-01"));
    expect(zukunft.status).toBe(400);
    await expect(zukunft.json()).resolves.toMatchObject({
      error: { code: "beitraege_stichtag_in_zukunft" }
    });

    const fehlt = await dispatch(checkinRequest("/api/checkin/v1/beitraege?stichtag=2026-01-15"));
    expect(fehlt.status).toBe(404);
    await expect(fehlt.json()).resolves.toMatchObject({
      error: { code: "beitraege_stichtag_nicht_gesichert" }
    });
  });

  it("liefert gesicherte Tagesstaende verschluesselt gespeichert zurueck", async () => {
    await seedMitglieder({ exMitglieder: 2 });
    const ergebnis = await sichereBeitragsStichtag(env, new Date("2026-09-01T09:30:00.000Z"));
    expect(ergebnis).toEqual({ stichtag: "2026-09-01", status: "gespeichert", vollstaendig: false });

    const roh = await env.DB.prepare(
      "SELECT payload_json, monatssumme_cent, ex_mitglieder FROM beitrags_stichtage WHERE stichtag = ?"
    )
      .bind("2026-09-01")
      .first<{ ex_mitglieder: number; monatssumme_cent: number; payload_json: string }>();
    expect(roh?.payload_json.startsWith("enc:v1:")).toBe(true);
    expect(roh?.payload_json).not.toContain("Erika");
    expect(roh).toMatchObject({ monatssumme_cent: 9940, ex_mitglieder: 2 });

    // Spaetere Aenderungen am Bestand aendern den gesicherten Tag nicht.
    await env.DB.prepare(
      "DELETE FROM matool_snapshots WHERE area = 'schueler' AND source_id = '9100002'"
    ).run();

    const response = await dispatch(checkinRequest("/api/checkin/v1/beitraege?stichtag=2026-09-01"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as CheckinAntwort;
    expect(body).toMatchObject({ stichtag: "2026-09-01", quelle: "archiv" });
    expect(body.zusammenfassung).toMatchObject({ mitglieder_gesamt: 4, ex_mitglieder: 2 });
    expect(body.mitglieder.map((mitglied) => mitglied.nachname)).toEqual(["Beispiel", "Muster"]);
    const live = (await (
      await dispatch(checkinRequest("/api/checkin/v1/beitraege"))
    ).json()) as CheckinAntwort;
    expect(live.zusammenfassung.mitglieder_gesamt).toBe(3);

    const liste = await dispatch(checkinRequest("/api/checkin/v1/beitraege/stichtage"));
    const listenText = await liste.text();
    expect(listenText).not.toContain("Erika");
    expect(JSON.parse(listenText)).toMatchObject({
      schema_version: 1,
      stichtage: [
        expect.objectContaining({
          stichtag: "2026-09-01",
          monatssumme_cent: 9940,
          einzug_nach_tag: [
            { tag: 7, cent: 3950, zahler: 1 },
            { tag: 15, cent: 5990, zahler: 1 }
          ],
          einzug_unklar: { cent: 0, zahler: 0 }
        })
      ]
    });
  });

  it("ersetzt einen vollstaendigen Tagesstand nie durch einen unvollstaendigen", async () => {
    await seedMitglieder({ ohneNeuzugang: true });
    expect(await sichereBeitragsStichtag(env, new Date("2026-09-15T08:00:00.000Z"))).toMatchObject({
      status: "gespeichert",
      vollstaendig: true
    });

    // Neuzugang ohne Stammdaten: der Bestand ist wieder unvollstaendig.
    const vorher = await env.DB.prepare("SELECT payload_json FROM beitrags_stichtage").first();
    await env.DB.prepare(
      "DELETE FROM matool_snapshots WHERE area = 'schueler_details' AND source_id = '9100002'"
    ).run();
    expect(await sichereBeitragsStichtag(env, new Date("2026-09-15T16:00:00.000Z"))).toEqual({
      grund: "vollstaendiger_stand_vorhanden",
      stichtag: "2026-09-15",
      status: "uebersprungen"
    });
    expect(await env.DB.prepare("SELECT payload_json FROM beitrags_stichtage").first()).toEqual(vorher);
    const gesichert = await ladeBeitragsStichtag(env, "2026-09-15");
    expect(gesichert?.uebersicht.zusammenfassung.vollstaendig).toBe(true);
  });

  it("speichert nur am 1. und 15. und raeumt andere Tage weg", async () => {
    await seedMitglieder();
    // Abrechnungsstichtage bleiben unbegrenzt: Auch Jahre spaeter laesst sich
    // nachsehen, wie die Beitraege an einem 1. oder 15. aussahen.
    for (const stichtag of ["2019-02-15", "2025-01-01", "2025-01-15", "2025-01-16", "2026-09-10"]) {
      await env.DB.prepare(
        `INSERT INTO beitrags_stichtage (stichtag, erstellt_am, vollstaendig, monatssumme_cent,
           mitglieder_gesamt, mit_beitrag, ohne_beitrag, stillgelegt, ex_mitglieder, payload_json)
         VALUES (?, ?, 1, 0, 0, 0, 0, 0, NULL, 'enc:placeholder')`
      )
        .bind(stichtag, `${stichtag}T20:00:00.000Z`)
        .run();
    }
    expect(await sichereBeitragsStichtag(env, new Date("2026-09-20T09:00:00.000Z"))).toEqual({
      grund: "kein_abrechnungstag",
      stichtag: "2026-09-20",
      status: "uebersprungen"
    });
    const tage = (
      await env.DB.prepare("SELECT stichtag FROM beitrags_stichtage ORDER BY stichtag").all<{ stichtag: string }>()
    ).results.map((row) => row.stichtag);
    expect(tage).toEqual(["2019-02-15", "2025-01-01", "2025-01-15"]);
  });

  it("legt die Tabelle selbst an, wenn der Deploy ohne Migration kam", async () => {
    await seedMitglieder();
    await env.DB.prepare("DROP TABLE beitrags_stichtage").run();
    // Die Datenschutz-Kachel der Uebersicht darf daran nicht scheitern.
    await expect(dataProtectionStatus(env)).resolves.toMatchObject({ unprotectedPayloads: expect.any(Number) });
    await env.DB.prepare("DROP TABLE beitrags_stichtage").run();
    expect(await sichereBeitragsStichtag(env, new Date("2026-10-01T09:00:00.000Z"))).toMatchObject({
      status: "gespeichert"
    });
    const liste = await dispatch(checkinRequest("/api/checkin/v1/beitraege/stichtage"));
    expect(liste.status).toBe(200);
  });

  it("sichert den Tag auch im naechtlichen Tagesabschluss ohne MATOOL-Abruf", async () => {
    await seedMitglieder();
    const lauf = (zeit: string) =>
      handleScheduledInvocation(
        { cron: "30 21 * * *", noRetry: () => undefined, scheduledTime: Date.parse(zeit) } as ScheduledController,
        env
      );
    // 21:30 UTC ist in Berlin noch derselbe Tag.
    await lauf("2026-10-14T21:30:00.000Z");
    await lauf("2026-10-15T21:30:00.000Z");
    const tage = (
      await env.DB.prepare("SELECT stichtag FROM beitrags_stichtage").all<{ stichtag: string }>()
    ).results.map((row) => row.stichtag);
    expect(tage).toEqual(["2026-10-15"]);
  });
});
