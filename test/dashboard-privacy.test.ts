import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatoolClient } from "../src/matool/client";
import {
  PROTECTED_DASHBOARD_VALUE,
  dashboardColumns,
  dashboardFieldValues,
  dashboardValues,
  parseStoredPayload,
  requireDashboardSourceId,
  searchableDashboardFields
} from "../src/worker/dashboard-privacy";
import type { Env } from "../src/worker/env";
import worker from "../src/worker";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard-Datenschutz", () => {
  it("maskiert generische c-Felder immer und laesst nur sichere Metadaten sichtbar", () => {
    const payload = {
      c00: "A",
      c01: "sehr-langer-personenbezogener-wert",
      c09: 4711,
      c63: true,
      columnCount: 64,
      status: "Neu",
      tableIndex: 2
    };
    const columns = dashboardColumns("interessenten", [payload]);
    const definitions = new Map(columns.map((column) => [column.key, column]));
    const values = dashboardValues("interessenten", payload, columns);

    for (const key of ["c00", "c01", "c09", "c63"]) {
      expect(definitions.get(key)?.masked).toBe(true);
      expect(values[key]).toBe(PROTECTED_DASHBOARD_VALUE);
    }
    expect(definitions.get("status")?.masked).toBe(false);
    expect(values.status).toBe("Neu");
    expect(values.columnCount).toBe("64");
    expect(values.tableIndex).toBe("2");
  });

  it.each([
    "firstName",
    "lastName",
    "name",
    "vorname",
    "nachname",
    "email",
    "mail",
    "phone",
    "telefon",
    "mobil",
    "adresse",
    "anschrift",
    "strasse",
    "plz",
    "ort",
    "geburtsdatum",
    "birth_date",
    "freitext",
    "notiz",
    "beschreibung",
    "liveLink",
    "sms30Text",
    "iban"
  ])("maskiert das personenbezogene Feld %s", (key) => {
    const [field] = dashboardFieldValues("interessenten", {
      [key]: "PII-SENTINEL-DARF-NICHT-SICHTBAR-SEIN"
    });

    expect(field).toMatchObject({
      key,
      masked: true,
      value: PROTECTED_DASHBOARD_VALUE
    });
  });

  it("zeigt bei Klassen ausschliesslich die sichere Allowlist im Klartext", () => {
    const payload = {
      id: "class-4711",
      id_schulintern: "KW-17",
      kurzname: "Kinder Anfaenger",
      wochentag: "Montag",
      startzeit_h: "17",
      startzeit_m: "30",
      endzeit_h: "18",
      endzeit_m: "30",
      kapazitaet: "20",
      raum: "Halle 1",
      schule: "KwonRo",
      sparte: "Taekwondo",
      online: "0",
      benutzer: "PII-BENUTZER-SENTINEL",
      beschreibung: "PII-FREITEXT-SENTINEL",
      liveLink: "https://private.invalid/PII-SENTINEL",
      sms30Text: "PII-SMS-SENTINEL",
      c00: "PII-ZELLWERT-SENTINEL",
      unbekanntesFeld: "PII-UNBEKANNT-SENTINEL"
    };
    const fields = new Map(
      dashboardFieldValues("klassen", payload).map((field) => [field.key, field])
    );

    for (const key of [
      "id",
      "id_schulintern",
      "kurzname",
      "wochentag",
      "startzeit_h",
      "startzeit_m",
      "endzeit_h",
      "endzeit_m",
      "kapazitaet",
      "raum",
      "schule",
      "sparte",
      "online"
    ]) {
      expect(fields.get(key)?.masked).toBe(false);
      expect(fields.get(key)?.value).toBe(String(payload[key as keyof typeof payload]));
    }
    for (const key of [
      "benutzer",
      "beschreibung",
      "liveLink",
      "sms30Text",
      "c00",
      "unbekanntesFeld"
    ]) {
      expect(fields.get(key)?.masked).toBe(true);
      expect(fields.get(key)?.value).toBe(PROTECTED_DASHBOARD_VALUE);
    }
  });

  it("verwendet fuer jeden nichtleeren Schutzwert dieselbe konstante Maske", () => {
    const shortValue = dashboardFieldValues("interessenten", { c00: "A" })[0];
    const longValue = dashboardFieldValues("interessenten", {
      c00: "X".repeat(2_000)
    })[0];
    const structuredValue = dashboardFieldValues("interessenten", {
      c00: { nested: "PII-SENTINEL" }
    })[0];

    expect(shortValue?.value).toBe(PROTECTED_DASHBOARD_VALUE);
    expect(longValue?.value).toBe(shortValue?.value);
    expect(structuredValue?.value).toBe(shortValue?.value);
    expect(shortValue?.value).not.toContain("A");
    expect(longValue?.value).not.toHaveLength(2_000);
  });

  it("prueft sensible Felder erneut und vertraut keiner manipulierten Spaltendefinition", () => {
    const values = dashboardValues(
      "klassen",
      { email: "PII-EMAIL-SENTINEL" },
      [{ key: "email", label: "E-Mail", masked: false }]
    );

    expect(values.email).toBe(PROTECTED_DASHBOARD_VALUE);
    expect(JSON.stringify(values)).not.toContain("PII-EMAIL-SENTINEL");
  });

  it("zeigt alle Interessenten-Detailfelder nur im ausdruecklichen Klartext-Testmodus", () => {
    const payload = {
      datum: "SYNTHETISCHES-DATUM",
      anrede: "SYNTHETISCHE-ANREDE",
      vorname: "PII-VORNAME-SENTINEL",
      name: "PII-NACHNAME-SENTINEL",
      strasse: "PII-STRASSE-SENTINEL",
      plz: "PII-PLZ-SENTINEL",
      ort: "PII-ORT-SENTINEL",
      telefon: "PII-TELEFON-SENTINEL",
      handy: "PII-HANDY-SENTINEL",
      email: "pii-email-sentinel@example.invalid",
      quelle: "SYNTHETISCHE-QUELLE",
      kontakt: "SYNTHETISCHER-KONTAKT",
      kontaktart: "SYNTHETISCHE-KONTAKTART",
      schule: "SYNTHETISCHE-SCHULE",
      leistung: "SYNTHETISCHE-LEISTUNG",
      einfuehrung: "SYNTHETISCHES-PROBETRAINING-1",
      einfuehrung_klasse_name: "SYNTHETISCHE-KLASSE-1",
      einfuehrung_zeit: "SYNTHETISCHE-UHRZEIT-1",
      ergebnis_einfuehrung: "SYNTHETISCHES-ERGEBNIS-1",
      probetraining: "SYNTHETISCHES-PROBETRAINING-2",
      probetraining_klasse_name: "SYNTHETISCHE-KLASSE-2",
      probetraining_zeit: "SYNTHETISCHE-UHRZEIT-2",
      ergebnis_probetraining: "SYNTHETISCHES-ERGEBNIS-2",
      status: "Termin",
      text: "PII-ANMERKUNG-SENTINEL",
      werbung: "SYNTHETISCHE-WERBEQUELLE",
      werbung_bezeichnung: "SYNTHETISCHE-WERBEQUELLEN-BEZEICHNUNG",
      werbung_formular: "SYNTHETISCHER-WERBEQUELLEN-FORMULARWERT"
    };

    const plaintext = new Map(
      dashboardFieldValues("interessenten_details", payload, true).map(
        (field) => [field.key, field]
      )
    );
    expect(plaintext.get("email")).toMatchObject({
      label: "E-Mail",
      masked: false,
      value: payload.email
    });
    expect(plaintext.get("text")).toMatchObject({
      label: "Anmerkung",
      masked: false,
      value: payload.text
    });
    expect(plaintext.get("einfuehrung")).toMatchObject({
      label: "Probetraining 1 - Datum",
      masked: false,
      value: payload.einfuehrung
    });
    expect(plaintext.get("probetraining")).toMatchObject({
      label: "Probetraining 2 - Datum",
      masked: false,
      value: payload.probetraining
    });
    expect(plaintext.get("einfuehrung_klasse_name")?.label).toBe(
      "Probetraining 1 - Klassenname"
    );
    expect(plaintext.get("ergebnis_einfuehrung")?.label).toBe(
      "Probetraining 1 - Ergebnis"
    );
    expect(plaintext.get("probetraining_klasse_name")?.label).toBe(
      "Probetraining 2 - Klassenname"
    );
    expect(plaintext.get("ergebnis_probetraining")?.label).toBe(
      "Probetraining 2 - Ergebnis"
    );
    expect(plaintext.get("werbung")?.label).toBe("Werbequelle");
    expect(plaintext.get("werbung_bezeichnung")?.label).toBe(
      "Werbequelle - Bezeichnung"
    );

    const protectedFields = new Map(
      dashboardFieldValues("interessenten_details", payload).map((field) => [
        field.key,
        field
      ])
    );
    for (const key of Object.keys(payload).filter((key) => key !== "status")) {
      expect(protectedFields.get(key)).toMatchObject({
        masked: true,
        value: PROTECTED_DASHBOARD_VALUE
      });
    }
    expect(protectedFields.get("status")).toMatchObject({
      masked: false,
      value: "Termin"
    });
  });

  it("stellt nur nicht-sensitive Klassenfelder fuer die serverseitige Suche bereit", () => {
    const searchable = searchableDashboardFields("klassen");
    expect(searchable).toEqual(expect.arrayContaining([
      "id",
      "id_schulintern",
      "kurzname",
      "kapazitaet",
      "raum",
      "schule",
      "sparte",
      "wochentag"
    ]));
    for (const key of [
      "benutzer",
      "beschreibung",
      "liveLink",
      "sms30Text",
      "c00",
      "alter_start",
      "alter_ende"
    ]) {
      expect(searchable).not.toContain(key);
    }
    expect(searchableDashboardFields("interessenten")).toEqual([]);

    for (const key of searchable) {
      const [definition] = dashboardColumns("klassen", [{ [key]: "test" }]);
      expect(definition).toMatchObject({ key, masked: false });
    }
  });

  it.each([
    "a",
    "900001",
    "record_abc-123",
    "0123456789abcdef0123456789abcdef",
    `a${"b".repeat(127)}`
  ])("akzeptiert eine sichere technische oder oeffentliche ID: %s", (value) => {
    expect(requireDashboardSourceId(value)).toBe(value);
  });

  it.each([
    "",
    "-leading-dash",
    "_leading-underscore",
    "mit leerzeichen",
    "../pfad",
    "id?raw=true",
    "id#fragment",
    "id%2Fsecret",
    "id' OR 1=1--",
    "umlaut-\u00e4",
    "zeile\numbruch",
    `a${"b".repeat(128)}`
  ])("weist eine unsichere technische oder oeffentliche ID ab: %s", (value) => {
    expect(() => requireDashboardSourceId(value)).toThrowError(
      expect.objectContaining({
        code: "invalid_dashboard_source_id",
        status: 400
      })
    );
  });

  it("gibt bei ungueltigem gespeichertem JSON niemals Rohtext zurueck", () => {
    expect(parseStoredPayload("PII-SENTINEL-kein-JSON")).toEqual({});
    expect(parseStoredPayload('["PII-SENTINEL"]')).toEqual({});
    expect(parseStoredPayload("null")).toEqual({});
  });

  it("zeigt Testdaten bei ausdruecklich aktiviertem Klartext-Testmodus", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const piiSentinel = `PII-DASHBOARD-${suffix}`;
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["email", "firstName", "phone", "status"],
      area: "interessenten",
      finishedAt: "2099-08-03T10:00:02.000Z",
      observedAt: "2099-08-03T10:00:01.000Z",
      records: [
        {
          sourceId: `9${suffix.slice(0, 20)}`,
          payload: {
            email: `${piiSentinel}@example.invalid`,
            firstName: piiSentinel,
            phone: `+49${suffix.slice(0, 12)}`,
            status: "Neu"
          }
        }
      ],
      runId: `privacy_${suffix}`,
      startedAt: "2099-08-03T10:00:00.000Z"
    });

    const runtimeEnv = {
      ...env,
      APP_ENV: "staging",
      PUBLIC_DASHBOARD_PLAINTEXT: "true",
      PUBLIC_DASHBOARD_READ_ONLY: "true"
    } as Env;
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request(
        "https://matool-middleware-staging.example.invalid/api/admin/v1/dashboard/records?area=interessenten&pageSize=100"
      ),
      runtimeEnv,
      context
    );
    await waitOnExecutionContext(context);
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(serialized).not.toContain(PROTECTED_DASHBOARD_VALUE);
    expect(serialized).toContain(piiSentinel);
    expect(serialized).toContain(`${piiSentinel}@example.invalid`);
    expect(serialized).not.toContain(`9${suffix.slice(0, 20)}`);
    expect(serialized).toContain(`+49${suffix.slice(0, 12)}`);
  });

  it("maskiert Interessentenwerte am Snapshot-Endpunkt ohne Klartext-Testmodus", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const piiSentinel = `PII-MASKED-${suffix}`;
    await persistMatoolSnapshotRun(env.DB, {
      allowedPayloadFields: ["email", "firstName", "phone", "status"],
      area: "interessenten",
      finishedAt: "2099-08-04T10:00:02.000Z",
      observedAt: "2099-08-04T10:00:01.000Z",
      records: [
        {
          sourceId: `8${suffix.slice(0, 20)}`,
          payload: {
            email: `${piiSentinel}@example.invalid`,
            firstName: piiSentinel,
            phone: `+49${suffix.slice(0, 12)}`,
            status: "Neu"
          }
        }
      ],
      runId: `privacy_masked_${suffix}`,
      startedAt: "2099-08-04T10:00:00.000Z"
    });

    const runtimeEnv = {
      ...env,
      APP_ENV: "staging",
      PUBLIC_DASHBOARD_PLAINTEXT: "false",
      PUBLIC_DASHBOARD_READ_ONLY: "true"
    } as Env;
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request(
        "https://matool-middleware-staging.example.invalid/api/admin/v1/dashboard/records?area=interessenten&pageSize=100"
      ),
      runtimeEnv,
      context
    );
    await waitOnExecutionContext(context);
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(serialized).toContain(PROTECTED_DASHBOARD_VALUE);
    expect(serialized).not.toContain(piiSentinel);
    expect(serialized).not.toContain(`${piiSentinel}@example.invalid`);
    expect(serialized).not.toContain(`8${suffix.slice(0, 20)}`);
    expect(serialized).not.toContain(`+49${suffix.slice(0, 12)}`);
  });
});

describe("MATOOL-Logging ohne Personendaten", () => {
  it("uebernimmt cause.message mit PII-Sentinel nicht in console-Ausgaben", async () => {
    const piiSentinel = "PII-CAUSE-MESSAGE-SENTINEL-4711";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new MatoolClient(
      "https://core.matool.de",
      (async () => {
        throw new Error(piiSentinel);
      }) as typeof fetch
    );

    await expect(
      client.probeInteressenten({
        email: "synthetic-privacy-test@example.invalid",
        password: "synthetic-test-password"
      })
    ).rejects.toMatchObject({
      code: "matool_network_error"
    });

    const serializedLogs = JSON.stringify(errorLog.mock.calls);
    // Der Client wiederholt einen abgebrochenen Netzwerkabruf genau einmal
    // und protokolliert beide anonymisierten Versuche.
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(
      errorLog.mock.calls.map(([line]) => JSON.parse(String(line)).attempt)
    ).toEqual([1, 2]);
    expect(serializedLogs).toContain("matool_fetch_failed");
    expect(serializedLogs).not.toContain(piiSentinel);
    expect(serializedLogs).not.toContain("synthetic-privacy-test@example.invalid");
    expect(serializedLogs).not.toContain("synthetic-test-password");
  });
});
