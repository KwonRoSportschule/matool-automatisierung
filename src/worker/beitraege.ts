import { AppError } from "../core/app-error";
import {
  BEITRAGS_STAMMDATEN_FELDER,
  beitragsDateiname,
  beitragsRegelnAusUmgebung,
  beitragsUebersichtAlsXml,
  centAlsDezimal,
  centAlsEuroText,
  erstelleBeitragsUebersicht,
  zaehleFeldwerte,
  type BeitragsQuelle,
  type BeitragsRegeln,
  type BeitragsUebersicht
} from "../core/beitraege";
import { PROTECTED_DASHBOARD_VALUE, parseStoredPayload } from "./dashboard-privacy";
import type { Env } from "./env";
import { storedPayloadCipher } from "./payload-encryption";

/** Felder der Mitgliederliste, die in die Uebersicht einfliessen. */
const LISTEN_FELDER = ["nr", "vorname", "name", "vertrag"] as const;

interface BeitragsSnapshotRow {
  area: string;
  last_seen_at: string;
  payload_json: string;
  source_id: string;
}

/**
 * Liest den aktuellen Mitgliederbestand samt Stammdaten aus D1. Massgeblich
 * ist die Mitgliederliste: Sie wird bei jedem vollstaendigen Abruf exakt
 * ersetzt. Stammdaten ausgetretener Mitglieder bleiben dadurch aussen vor.
 */
export async function ladeBeitragsQuellen(env: Env): Promise<BeitragsQuelle[]> {
  let rows: BeitragsSnapshotRow[];
  try {
    rows = (
      await env.DB.prepare(
        `SELECT area, source_id, payload_json, last_seen_at
         FROM matool_snapshots
         WHERE area IN ('schueler', 'schueler_details')`
      ).all<BeitragsSnapshotRow>()
    ).results;
  } catch {
    throw new AppError(
      "beitraege_store_unavailable",
      503,
      "Die Mitgliederdaten sind momentan nicht abrufbar."
    );
  }

  const cipher = await storedPayloadCipher(env);
  const liste = new Map<string, Record<string, unknown>>();
  const stammdaten = new Map<
    string,
    { payload: Record<string, unknown>; stand: string }
  >();
  for (const row of rows) {
    const payload = parseStoredPayload(
      await cipher.open({ area: row.area, sourceId: row.source_id }, row.payload_json)
    );
    if (row.area === "schueler") {
      liste.set(row.source_id, auswahl(payload, LISTEN_FELDER));
    } else {
      stammdaten.set(row.source_id, {
        payload: auswahl(payload, BEITRAGS_STAMMDATEN_FELDER),
        stand: row.last_seen_at
      });
    }
  }

  return [...liste.entries()].map(([sourceId, listenFelder]) => {
    const details = stammdaten.get(sourceId);
    return {
      sourceId,
      liste: listenFelder,
      stammdaten: details?.payload ?? null,
      stammdatenStand: details?.stand ?? null
    };
  });
}

/** Nur die benannten Felder; alles andere verlaesst diese Funktion nicht. */
function auswahl(
  payload: Readonly<Record<string, unknown>>,
  felder: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    felder.filter((feld) => Object.hasOwn(payload, feld)).map((feld) => [feld, payload[feld]])
  );
}

export function beitragsRegeln(env: Env): BeitragsRegeln {
  try {
    return beitragsRegelnAusUmgebung(env);
  } catch (error) {
    throw new AppError(
      "beitraege_config_invalid",
      500,
      error instanceof Error ? error.message : "Die Beitragsregeln sind ungueltig."
    );
  }
}

/**
 * Stichtag aus der Anfrage (JJJJ-MM-TT) oder, ohne Angabe, das heutige
 * Datum in Europe/Berlin.
 */
export function beitragsStichtag(url: URL, jetzt: Date = new Date()): string {
  const angabe = url.searchParams.get("stichtag");
  if (angabe === null || angabe.trim() === "") {
    return berlinerDatum(jetzt);
  }
  const text = angabe.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  const datum = match ? new Date(`${text}T12:00:00.000Z`) : null;
  if (!datum || Number.isNaN(datum.getTime()) || datum.toISOString().slice(0, 10) !== text) {
    throw new AppError(
      "invalid_beitraege_stichtag",
      400,
      "Der Stichtag muss als JJJJ-MM-TT angegeben werden."
    );
  }
  return text;
}

function berlinerDatum(zeitpunkt: Date): string {
  const teile = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
    year: "numeric"
  }).formatToParts(zeitpunkt);
  const teil = (typ: string) => teile.find((eintrag) => eintrag.type === typ)?.value ?? "";
  return `${teil("year")}-${teil("month")}-${teil("day")}`;
}

export async function erstelleAktuelleBeitragsUebersicht(
  env: Env,
  stichtag: string
): Promise<{ quellen: BeitragsQuelle[]; uebersicht: BeitragsUebersicht }> {
  const regeln = beitragsRegeln(env);
  const quellen = await ladeBeitragsQuellen(env);
  return {
    quellen,
    uebersicht: erstelleBeitragsUebersicht(quellen, {
      erstelltAm: new Date().toISOString(),
      regeln,
      stichtag
    })
  };
}

/**
 * Ersetzt Namen und Kennungen fuer das Dashboard ohne Klartextfreigabe.
 * Betraege, Vertrag und Kundenart bleiben sichtbar, weil sie zur Pruefung
 * der Summe gebraucht werden und niemanden identifizieren.
 */
export function maskiereBeitragsUebersicht(
  uebersicht: BeitragsUebersicht
): BeitragsUebersicht {
  const person = {
    matoolId: PROTECTED_DASHBOARD_VALUE,
    mitgliedsnummer: PROTECTED_DASHBOARD_VALUE,
    nachname: PROTECTED_DASHBOARD_VALUE,
    vorname: PROTECTED_DASHBOARD_VALUE
  };
  return {
    ...uebersicht,
    positionen: uebersicht.positionen.map((position) => ({ ...position, ...person })),
    nichtEingerechnet: uebersicht.nichtEingerechnet.map((eintrag) => ({
      ...eintrag,
      ...person
    }))
  };
}

export function beitragsXmlResponse(uebersicht: BeitragsUebersicht): Response {
  return new Response(beitragsUebersichtAlsXml(uebersicht), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${beitragsDateiname(uebersicht.stichtag)}"`,
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": "application/xml; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}

/** Antwort fuer das Dashboard: Uebersicht plus Wertverteilung der Regelfelder. */
export async function dashboardBeitragsUebersicht(
  env: Env,
  url: URL,
  plaintext: boolean
): Promise<Record<string, unknown>> {
  const { quellen, uebersicht } = await erstelleAktuelleBeitragsUebersicht(
    env,
    beitragsStichtag(url)
  );
  return {
    uebersicht: plaintext ? uebersicht : maskiereBeitragsUebersicht(uebersicht),
    feldwerte: zaehleFeldwerte(quellen)
  };
}

/**
 * Flache Antwort fuer Zapier. Summen stehen oben, damit sie sich im Zap
 * direkt in E-Mail-Text oder Tabellen einsetzen lassen; die XML-Datei
 * liegt als Text bei und wird von der Zapier-App als Datei abgelegt.
 */
export async function zapierBeitragsUebersicht(
  env: Env,
  url: URL
): Promise<Record<string, unknown>> {
  const { uebersicht } = await erstelleAktuelleBeitragsUebersicht(
    env,
    beitragsStichtag(url)
  );
  const z = uebersicht.zusammenfassung;
  return {
    schema_version: uebersicht.schemaVersion,
    id: `beitraege:${uebersicht.stichtag}`,
    stichtag: uebersicht.stichtag,
    erstellt_am: uebersicht.erstelltAm,
    waehrung: uebersicht.waehrung,
    betragsbezug: uebersicht.regeln.betragsBezug,
    vollstaendig: z.vollstaendig,
    monatssumme: centAlsDezimal(z.monatssummeCent),
    monatssumme_cent: z.monatssummeCent,
    monatssumme_text: centAlsEuroText(z.monatssummeCent),
    jahresgebuehr_summe: centAlsDezimal(z.jahresgebuehrSummeCent),
    anzahl_mitglieder_gesamt: z.mitgliederGesamt,
    anzahl_eingerechnet: z.eingerechnet,
    anzahl_mit_beitrag: z.mitBeitrag,
    anzahl_ohne_beitrag: z.ohneBeitrag,
    anzahl_stillgelegt: z.stillgelegt,
    anzahl_stammdaten_fehlen: z.stammdatenFehlen,
    anzahl_nicht_berechenbar: z.nichtBerechenbar,
    datenstand_aeltester: z.datenstandAeltester,
    datenstand_neuester: z.datenstandNeuester,
    dateiname: beitragsDateiname(uebersicht.stichtag),
    xml: beitragsUebersichtAlsXml(uebersicht),
    mitglieder: uebersicht.positionen.map((position) => ({
      matool_id: position.matoolId,
      mitgliedsnummer: position.mitgliedsnummer,
      vorname: position.vorname,
      nachname: position.nachname,
      vertrag: position.vertrag,
      kundenart: position.kundenart,
      zahlungsperiode: position.zahlungsperiode,
      zahlart: position.zahlart,
      beitrag: centAlsDezimal(position.beitragCent),
      monatsbeitrag: centAlsDezimal(position.monatsbeitragCent)
    })),
    nicht_eingerechnet: uebersicht.nichtEingerechnet.map((eintrag) => ({
      matool_id: eintrag.matoolId,
      mitgliedsnummer: eintrag.mitgliedsnummer,
      vorname: eintrag.vorname,
      nachname: eintrag.nachname,
      vertrag: eintrag.vertrag,
      kundenart: eintrag.kundenart,
      grund: eintrag.grund,
      detail: eintrag.detail
    }))
  };
}
