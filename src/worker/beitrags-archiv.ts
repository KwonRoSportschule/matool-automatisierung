import { AppError, toAppError } from "../core/app-error";
import type {
  BeitragsUebersicht,
  FeldwertVerteilung
} from "../core/beitraege";
import {
  berlinerDatum,
  erstelleAktuelleBeitragsUebersicht
} from "./beitraege";
import type { Env } from "./env";
import { storedPayloadCipher } from "./payload-encryption";

/**
 * Tagesstaende der Beitragsuebersicht.
 *
 * Der Hub kennt nur den aktuellen Mitgliederbestand. Damit die
 * Klassenauswertung einen frueheren Stichtag (etwa den 1. oder 15. eines
 * Monats) zeigen kann, sichert jeder Cron-Lauf den Stand des laufenden Tages.
 * Pro Tag bleibt der letzte Stand stehen, ein vollstaendiger wird aber nie
 * durch einen unvollstaendigen ersetzt.
 *
 * Personenbezogene Inhalte liegen nur verschluesselt in payload_json; die
 * Kennzahlenspalten nennen niemanden.
 */

const ARCHIV_VERSION = 1;
const ARCHIV_BEREICH = "beitrags_stichtag";
const DEFAULT_AUFBEWAHRUNG_TAGE = 400;
const TAG_MS = 24 * 60 * 60 * 1_000;
/** Obergrenze fuer die Stichtagsliste (rund zwei Jahre Tagesstaende). */
const MAX_STICHTAGE_LISTE = 800;

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
}

export interface GesicherterBeitragsStand {
  feldwerte: FeldwertVerteilung[];
  uebersicht: BeitragsUebersicht;
}

export type BeitragsSicherungErgebnis =
  | { stichtag: string; status: "gespeichert"; vollstaendig: boolean }
  | {
      grund: "keine_mitgliederliste" | "vollstaendiger_stand_vorhanden";
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
}

/**
 * Sichert den aktuellen Stand fuer den heutigen Tag (Europe/Berlin) und
 * raeumt abgelaufene Tagesstaende auf.
 */
export async function sichereBeitragsStichtag(
  env: Env,
  jetzt: Date = new Date()
): Promise<BeitragsSicherungErgebnis> {
  const stichtag = berlinerDatum(jetzt);
  const { feldwerte, quellen, uebersicht } =
    await erstelleAktuelleBeitragsUebersicht(env, stichtag, jetzt);

  // Ohne gelesene Mitgliederliste gibt es nichts, das einen Tag belegt.
  if (quellen.length === 0) {
    return { grund: "keine_mitgliederliste", stichtag, status: "uebersprungen" };
  }

  await ensureBeitragsArchivSchema(env.DB);
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
       ex_mitglieder, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (stichtag) DO UPDATE SET
       erstellt_am = excluded.erstellt_am,
       vollstaendig = excluded.vollstaendig,
       monatssumme_cent = excluded.monatssumme_cent,
       mitglieder_gesamt = excluded.mitglieder_gesamt,
       mit_beitrag = excluded.mit_beitrag,
       ohne_beitrag = excluded.ohne_beitrag,
       stillgelegt = excluded.stillgelegt,
       ex_mitglieder = excluded.ex_mitglieder,
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
      payload
    )
    .run();

  await entferneAbgelaufeneTagesstaende(env, jetzt);
  await versiegleAelteStaende(env);

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
 * Tagesstaende verfallen nach der Aufbewahrungsfrist. Der 1. und der 15.
 * eines Monats sind Abrechnungsstichtage und bleiben immer erhalten.
 */
async function entferneAbgelaufeneTagesstaende(env: Env, jetzt: Date): Promise<void> {
  const grenze = berlinerDatum(
    new Date(jetzt.getTime() - aufbewahrungTage(env) * TAG_MS)
  );
  await env.DB.prepare(
    `DELETE FROM beitrags_stichtage
     WHERE stichtag < ?
       AND substr(stichtag, 9, 2) NOT IN ('01', '15')`
  )
    .bind(grenze)
    .run();
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

function aufbewahrungTage(env: Env): number {
  const text = env.BEITRAEGE_TAGESSTAND_AUFBEWAHRUNG_TAGE?.trim() ?? "";
  if (text === "") {
    return DEFAULT_AUFBEWAHRUNG_TAGE;
  }
  const tage = Number(text);
  // Ein Tippfehler darf nicht versehentlich die ganze Historie loeschen.
  return Number.isSafeInteger(tage) && tage >= 31 ? tage : DEFAULT_AUFBEWAHRUNG_TAGE;
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
                ex_mitglieder
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
    exMitglieder: row.ex_mitglieder
  }));
}

function archivNichtErreichbar(): AppError {
  return new AppError(
    "beitraege_store_unavailable",
    503,
    "Die gesicherten Beitragsstaende sind momentan nicht abrufbar."
  );
}
