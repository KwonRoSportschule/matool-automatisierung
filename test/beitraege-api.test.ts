import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/worker";
import type { Env } from "../src/worker/env";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

const serviceToken = "synthetic-service-token-at-least-32-characters";

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

async function seedMitglieder(): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM matool_snapshots WHERE area IN ('schueler', 'schueler_details')"
  ).run();
  const cipher = await storedPayloadCipher(env);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const liste = [
    { sourceId: "9100001", payload: { nr: "1", vorname: "Erika", name: "Beispiel", vertrag: "Erwachsene" } },
    { sourceId: "9100002", payload: { nr: "2", vorname: "Max", name: "Muster", vertrag: "Kinder" } },
    { sourceId: "9100003", payload: { nr: "3", vorname: "Ruth", name: "Ruhe", vertrag: "Erwachsene" } },
    { sourceId: "9100004", payload: { nr: "4", vorname: "Neu", name: "Zugang", vertrag: "Kinder" } }
  ];
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
    ["schueler_details", stammdaten]
  ] as const) {
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
  it("maskiert Namen ohne Klartextfreigabe, zeigt aber Betraege", async () => {
    const response = await dispatch(adminRequest("/api/admin/v1/beitraege"), {
      ...env,
      PUBLIC_DASHBOARD_PLAINTEXT: "false"
    } as Env);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("Erika");
    expect(text).not.toContain(IBAN_SENTINEL);
    const body = JSON.parse(text) as {
      feldwerte: Array<{ feld: string; werte: Array<{ anzahl: number; wert: string }> }>;
      masked: boolean;
      privacy: { mode: string };
      uebersicht: {
        positionen: Array<Record<string, unknown>>;
        zusammenfassung: Record<string, unknown>;
      };
    };
    expect(body.masked).toBe(true);
    expect(body.privacy.mode).toBe("server-side");
    expect(body.uebersicht.zusammenfassung.monatssummeCent).toBe(9940);
    expect(body.uebersicht.positionen[0]).toMatchObject({
      nachname: "Geschuetzt",
      monatsbeitragCent: 5990
    });
    expect(body.feldwerte.find((eintrag) => eintrag.feld === "kundenart")?.werte).toEqual([
      { anzahl: 2, wert: "Mitglied" },
      { anzahl: 1, wert: "(leer)" },
      { anzahl: 1, wert: "Stillgelegt" }
    ]);
  });

  it("liefert die XML-Datei als Download", async () => {
    const response = await dispatch(
      adminRequest("/api/admin/v1/beitraege.xml?stichtag=2026-10-15"),
      { ...env, PUBLIC_DASHBOARD_PLAINTEXT: "true" } as Env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="beitragsuebersicht_2026-10-15.xml"'
    );
    const xml = await response.text();
    expect(xml).toContain('stichtag="2026-10-15"');
    expect(xml).toContain("<vorname>Erika</vorname>");
    expect(xml).not.toContain(IBAN_SENTINEL);
  });
});
