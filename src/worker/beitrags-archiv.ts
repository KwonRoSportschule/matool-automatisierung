import { AppError, toAppError } from "../core/app-error";
import type {
  BeitragsUebersicht,
  EinzugsTagSumme,
  FeldwertVerteilung
} from "../core/beitraege";
import {
  berlinerDatum,
  erstelleAktuelleBeitragsUebersicht
} from "./beitraege";
import type { Env } from "./env";
import { storedPayloadCipher } from "./payload-encryption";

/**
 * Abrechnungsstichtage der Beitragsuebersicht.
 *
 * Eingezogen wird zum 1. und zum 15. eines Monats. Der Hub kennt nur den
 * aktuellen Mitgliederbestand; damit die Klassenauswertung spaeter sehen
 * kann, was an einem vergangenen 1. oder 15. faellig war, sichert jeder
 * Cron-Lauf an genau diesen beiden Tagen den Stand. Andere Tage werden nicht
 * gespeichert (Datensparsamkeit). Pro Tag bleibt der letzte Stand stehen, ein
 * vollstaendiger wird aber nie durch einen unvollstaendigen ersetzt.
 *
 * Einzugstage ausser dem 1. und 15. (aeltere Vertraege, abweichender
 * Einzug) werden mit abgebildet: Die Klassenauswertung nimmt fuer den 2. bis
 * 14. den Stand vom 1., fuer den 16. bis 31. den Stand vom 15.
 *
 * Personenbezogene Inhalte liegen nur verschluesselt in payload_json; die
 * Kennzahlenspalten nennen niemanden.
 */

const ARCHIV_VERSION = 1;
const ARCHIV_BEREICH = "beitrags_stichtag";
/** Obergrenze fuer die Stichtagsliste: zehn Jahre mit je 24 Stichtagen. */
const MAX_STICHTAGE_LISTE = 240;

/** Ist das Datum (JJJJ-MM-TT) ein Abrechnungsstichtag (1. oder 15.)? */
export function istAbrechnungsstichtag(stichtag: string): boolean {
  return /^\d{4}-\d{2}-(?:01|15)$/u.test(stichtag);
}

export interface BeitragsStichtagKennzahlen {
  stichtag: string;
  erstelltAm: string;
  vollstaendig: boolean;
  monatssummeCent: number;
  mitgliederGesamt: number;
  mitBeitrag: number;
  ohneBeitrag: number;
  stillgelegt: number;
  exMitglieder: number | null;
  einzugNachTag: EinzugsTagSumme[];
  einzugUnklar: { cent: number; zahler: number };
}

export interface GesicherterBeitragsStand {
  feldwerte: FeldwertVerteilung[];
  uebersicht: BeitragsUebersicht;
}

export type BeitragsSicherungErgebnis =
  | { stichtag: string; status: "gespeichert"; vollstaendig: boolean }
  | {
      grund:
        | "kein_abrechnungstag"
        | "keine_mitgliederliste"
        | "vollstaendiger_stand_vorhanden";
      stichtag: string;
      status: "uebersprungen";
    };

/**
 * Deployment-sichere Schema-Anlage wie in exact-sync-safety.ts: Der
 * GitHub-Deploy wendet D1-Migrationen nicht an. Ohne Tabelle fiele sonst die
 * Datenschutz-Kachel und damit die ganze Dashboard-Uebersicht aus. Die
 * Definition entspricht migrations/0011_beitrags_stichtage.sql.
 */
export async function ensureBeitragsArchivSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS beitrags_stichtage (
        stichtag TEXT PRIMARY KEY
          CHECK (stichtag GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        erstellt_am TEXT NOT NULL,
        vollstaendig INTEGER NOT NULL CHECK (vollstaendig IN (0, 1)),
        monatssumme_cent INTEGER NOT NULL,
        mitglieder_gesamt INTEGER NOT NULL,
        mit_beitrag INTEGER NOT NULL,
        ohne_beitrag INTEGER NOT NULL,
        stillgelegt INTEGER NOT NULL,
        ex_mitglieder INTEGER,
        einzug_json TEXT NOT NULL DEFAULT '{}',
        payload_json TEXT NOT NULL
      )`
    )
    .run();
}

interface KennzahlenRow {
  erstellt_am: string;
  ex_mitglieder: number | null;
  mit_beitrag: number;
  mitglieder_gesamt: number;
  monatssumme_cent: number;
  ohne_beitrag: number;
  stichtag: string;
  stillgelegt: number;
  vollstaendig: number;
  einzug_json: string;
}

/**
 * Sichert den aktuellen Stand, wenn heute (Europe/Berlin) der 1. oder 15.
 * ist. An allen anderen Tagen wird nichts berechnet und nichts gespeichert.
 */
export async function sichereBeitragsStichtag(
  env: Env,
  jetzt: Date = new Date()
): Promise<BeitragsSicherungErgebnis> {
  const stichtag = berlinerDatum(jetzt);
  await ensureBeitragsArchivSchema(env.DB);
  await entferneTageAusserhalbDerStichtage(env);
  await versiegleAelteStaende(env);
  if (!istAbrechnungsstichtag(stichtag)) {
    return { grund: "kein_abrechnungstag", stichtag, status: "uebersprungen" };
  }

  const { feldwerte, quellen, uebersicht } =
    await erstelleAktuelleBeitragsUebersicht(env, stichtag, jetzt);

  // Ohne gelesene Mitgliederliste gibt es nichts, das einen Tag belegt.
  if (quellen.length === 0) {
    return { grund: "keine_mitgliederliste", stichtag, status: "uebersprungen" };
  }

  const cipher = await storedPayloadCipher(env);
  const payload = await cipher.seal(
    { area: ARCHIV_BEREICH, sourceId: stichtag },
    JSON.stringify({ archivVersion: ARCHIV_VERSION, feldwerte, uebersicht })
  );
  const z = uebersicht.zusammenfassung;

  // Die Bedingung steht in derselben Anweisung wie das Schreiben, damit auch
  // zwei gleichzeitige Laeufe keinen vollstaendigen Stand ueberschreiben.
  const result = await env.DB.prepare(
    `INSERT INTO beitrags_stichtage (
       stichtag, erstellt_am, vollstaendig, monatssumme_cent,
       mitglieder_gesamt, mit_beitrag, ohne_beitrag, stillgelegt,
       ex_mitglieder, einzug_json, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (stichtag) DO UPDATE SET
       erstellt_am = excluded.erstellt_am,
       vollstaendig = excluded.vollstaendig,
       monatssumme_cent = excluded.monatssumme_cent,
       mitglieder_gesamt = excluded.mitglieder_gesamt,
       mit_beitrag = excluded.mit_beitrag,
       ohne_beitrag = excluded.ohne_beitrag,
       stillgelegt = excluded.stillgelegt,
       ex_mitglieder = excluded.ex_mitglieder,
       einzug_json = excluded.einzug_json,
       payload_json = excluded.payload_json
     WHERE excluded.erstellt_am >= beitrags_stichtage.erstellt_am
       AND (excluded.vollstaendig = 1 OR beitrags_stichtage.vollstaendig = 0)`
  )
    .bind(
      stichtag,
      uebersicht.erstelltAm,
      z.vollstaendig ? 1 : 0,
      z.monatssummeCent,
      z.mitgliederGesamt,
      z.mitBeitrag,
      z.ohneBeitrag,
      z.stillgelegt,
      z.exMitglieder,
      // Nur Summen je Tag, keine Personen: bleibt fuer den Verlauf lesbar.
      JSON.stringify({ tage: z.einzugNachTag, unklar: z.einzugUnklar }),
      payload
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return { grund: "vollstaendiger_stand_vorhanden", stichtag, status: "uebersprungen" };
  }
  return { stichtag, status: "gespeichert", vollstaendig: z.vollstaendig };
}

/** Wie sichereBeitragsStichtag, bricht aber nie den Cron-Lauf ab. */
export async function sichereBeitragsStichtagSafely(
  env: Env,
  jetzt: Date = new Date()
): Promise<void> {
  try {
    const ergebnis = await sichereBeitragsStichtag(env, jetzt);
    console.info(JSON.stringify({ event: "beitrags_stichtag_gesichert", ...ergebnis }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "beitrags_stichtag_sicherung_fehlgeschlagen",
        errorCode: toAppError(error).code
      })
    );
  }
}

/**
 * Nur der 1. und der 15. werden aufbewahrt. Staende anderer Tage (etwa aus
 * einer frueheren Version, die taeglich gesichert hat) werden entfernt.
 */
async function entferneTageAusserhalbDerStichtage(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM beitrags_stichtage
     WHERE substr(stichtag, 9, 2) NOT IN ('01', '15')`
  ).run();
}

/**
 * Versiegelt Tagesstaende neu, die noch ohne oder mit einem alten Schluessel
 * gespeichert sind (Schluessel nachtraeglich gesetzt oder gewechselt).
 */
async function versiegleAelteStaende(env: Env): Promise<void> {
  const cipher = await storedPayloadCipher(env);
  const kopf = cipher.currentHeader;
  if (!kopf) {
    return;
  }
  const rows = (
    await env.DB.prepare(
      `SELECT stichtag, payload_json
       FROM beitrags_stichtage
       WHERE substr(payload_json, 1, ?) <> ?
       LIMIT 50`
    )
      .bind(kopf.length, kopf)
      .all<{ payload_json: string; stichtag: string }>()
  ).results;
  for (const row of rows) {
    const kontext = { area: ARCHIV_BEREICH, sourceId: row.stichtag };
    let neu: string;
    try {
      neu = await cipher.seal(kontext, await cipher.open(kontext, row.payload_json));
    } catch {
      // Unlesbar (etwa ein verlorener Altschluessel): stehen lassen. Die
      // Datenschutz-Kachel zaehlt die Zeile weiter als ungeschuetzt.
      continue;
    }
    await env.DB.prepare(
      `UPDATE beitrags_stichtage SET payload_json = ?
       WHERE stichtag = ? AND payload_json = ?`
    )
      .bind(neu, row.stichtag, row.payload_json)
      .run();
  }
}

/** Liest einen gesicherten Tagesstand; null, wenn es fuer den Tag keinen gibt. */
export async function ladeBeitragsStichtag(
  env: Env,
  stichtag: string
): Promise<GesicherterBeitragsStand | null> {
  let row: { payload_json: string } | null;
  try {
    await ensureBeitragsArchivSchema(env.DB);
    row = await env.DB.prepare(
      "SELECT payload_json FROM beitrags_stichtage WHERE stichtag = ?"
    )
      .bind(stichtag)
      .first<{ payload_json: string }>();
  } catch {
    throw archivNichtErreichbar();
  }
  if (!row) {
    return null;
  }

  const cipher = await storedPayloadCipher(env);
  const klartext = await cipher.open(
    { area: ARCHIV_BEREICH, sourceId: stichtag },
    row.payload_json
  );
  let inhalt: unknown;
  try {
    inhalt = JSON.parse(klartext);
  } catch {
    inhalt = null;
  }
  if (
    inhalt === null ||
    typeof inhalt !== "object" ||
    (inhalt as { archivVersion?: unknown }).archivVersion !== ARCHIV_VERSION
  ) {
    throw new AppError(
      "beitraege_stichtag_unlesbar",
      500,
      "Der gesicherte Stand dieses Stichtags ist nicht lesbar."
    );
  }
  const { feldwerte, uebersicht } = inhalt as GesicherterBeitragsStand;
  return { feldwerte, uebersicht };
}

/** Alle gesicherten Tage mit ihren Kennzahlen, neueste zuerst. */
export async function listeBeitragsStichtage(
  env: Env
): Promise<BeitragsStichtagKennzahlen[]> {
  let rows: KennzahlenRow[];
  try {
    await ensureBeitragsArchivSchema(env.DB);
    rows = (
      await env.DB.prepare(
        `SELECT stichtag, erstellt_am, vollstaendig, monatssumme_cent,
                mitglieder_gesamt, mit_beitrag, ohne_beitrag, stillgelegt,
                ex_mitglieder, einzug_json
         FROM beitrags_stichtage
         ORDER BY stichtag DESC
         LIMIT ?`
      )
        .bind(MAX_STICHTAGE_LISTE)
        .all<KennzahlenRow>()
    ).results;
  } catch {
    throw archivNichtErreichbar();
  }
  return rows.map((row) => ({
    stichtag: row.stichtag,
    erstelltAm: row.erstellt_am,
    vollstaendig: row.vollstaendig === 1,
    monatssummeCent: row.monatssumme_cent,
    mitgliederGesamt: row.mitglieder_gesamt,
    mitBeitrag: row.mit_beitrag,
    ohneBeitrag: row.ohne_beitrag,
    stillgelegt: row.stillgelegt,
    exMitglieder: row.ex_mitglieder,
    ...einzugAusSpalte(row.einzug_json)
  }));
}

function einzugAusSpalte(text: string): {
  einzugNachTag: EinzugsTagSumme[];
  einzugUnklar: { cent: number; zahler: number };
} {
  try {
    const wert = JSON.parse(text) as {
      tage?: EinzugsTagSumme[];
      unklar?: { cent: number; zahler: number };
    };
    return {
      einzugNachTag: Array.isArray(wert.tage) ? wert.tage : [],
      einzugUnklar: wert.unklar ?? { cent: 0, zahler: 0 }
    };
  } catch {
    return { einzugNachTag: [], einzugUnklar: { cent: 0, zahler: 0 } };
  }
}

function archivNichtErreichbar(): AppError {
  return new AppError(
    "beitraege_store_unavailable",
    503,
    "Die gesicherten Beitragsstaende sind momentan nicht abrufbar."
  );
}
