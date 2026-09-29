import { AppError } from "../core/app-error";
import {
  describeJsonShape,
  MatoolShapeMismatchError
} from "./response-shape";

export interface MatoolStilllegungRecord {
  payload: Record<string, number | string>;
  sourceId: string;
}

export interface MatoolStilllegungZeitraum {
  /** Erster ruhender Monat, JJJJ-MM. */
  von: string;
  /** Letzter ruhender Monat, JJJJ-MM; leer, wenn kein Ende eingetragen ist. */
  bis: string;
  /** Status laut MATOOL, kleingeschrieben (z. B. "aktiv"). */
  status: string;
}

const MAX_STILLLEGUNGEN_PER_MEMBER = 200;

/**
 * Felder des Formular-Eintrags, den MATOOL fuer ein Mitglied ohne
 * Stilllegung liefert (live belegt am 29.09.2026): kein Satz, kein Zeitraum,
 * nur Name, Zahlungsperiode, Status und die Monatsliste des Formulars.
 */
const FORMULAR_FELDER = new Set(["name", "zahlungsperiode", "status", "periondenarray"]);
const MAX_STATUS_LENGTH = 40;
const MAX_TEXT_LENGTH = 500;

/**
 * Liest die Stilllegungen eines Mitglieds aus `stilllegung_daten.php`.
 *
 * Bestaetigte Antwort (29.09.2026): ein JSON-Array mit je einem Eintrag pro
 * Stilllegung -- `satz_id`, `von_monat`, `von_jahr`, `bis_monat`,
 * `bis_jahr`, `status`, `zahlungsperiode`, `periodejanein`, dazu Name und
 * eine Monatsliste fuer das Formular. Name und Formularwerte werden nicht
 * uebernommen.
 *
 * Ergebnis ist genau ein Datensatz je Mitglied, auch ohne Stilllegung. So
 * ueberschreibt der naechste Abruf eine in MATOOL geloeschte Stilllegung,
 * statt dass ein alter Zeitraum stehen bleibt.
 */
export function parseStilllegungResponse(
  body: Uint8Array,
  memberId: string
): MatoolStilllegungRecord {
  if (!/^\d{1,32}$/u.test(memberId)) {
    throw stilllegungSchemaError(undefined);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
      .decode(body)
      .trim();
  } catch {
    throw stilllegungSchemaError(undefined);
  }

  let parsed: unknown = [];
  // Ohne Stilllegung antwortet MATOOL mit einer leeren Liste; ein leerer
  // Rumpf oder "null" bedeutet dasselbe.
  if (text !== "" && text !== "null") {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw stilllegungSchemaError(undefined);
    }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_STILLLEGUNGEN_PER_MEMBER) {
    throw stilllegungSchemaError(parsed);
  }
  // Ohne Stilllegung antwortet MATOOL mit genau einem Formular-Eintrag.
  // Neben echten Zeitraeumen, doppelt oder mit weiteren Feldern bleibt er
  // ein Fehler (dann fehlt ihm unten die satz_id).
  const eintraege: unknown[] =
    parsed.length === 1 && istFormularEintrag(parsed[0]) ? [] : parsed;

  const zeitraeume: Array<MatoolStilllegungZeitraum & { satzId: string }> = [];
  const satzIds = new Set<string>();
  for (const entry of eintraege) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw stilllegungSchemaError(parsed);
    }
    const source = entry as Record<string, unknown>;
    const satzId = numericId(source.satz_id);
    const von = monat(source.von_monat, source.von_jahr);
    const bis = offenesEnde(source.bis_monat, source.bis_jahr)
      ? ""
      : monat(source.bis_monat, source.bis_jahr);
    const status = statusText(source.status);
    if (
      !satzId ||
      !von ||
      bis === undefined ||
      status === undefined ||
      !optionalText(source.name) ||
      !optionalText(source.zahlungsperiode) ||
      !optionalText(source.periodejanein) ||
      satzIds.has(satzId)
    ) {
      throw stilllegungSchemaError(parsed);
    }
    satzIds.add(satzId);
    zeitraeume.push({ von, bis, status, satzId });
  }

  zeitraeume.sort(
    (links, rechts) =>
      links.von.localeCompare(rechts.von) ||
      (links.bis || "9999-99").localeCompare(rechts.bis || "9999-99") ||
      links.satzId.localeCompare(rechts.satzId)
  );
  return {
    payload: {
      anzahl: zeitraeume.length,
      mitglied_id: memberId,
      zeitraeume: stilllegungsText(zeitraeume)
    },
    sourceId: memberId
  };
}

/**
 * Lesbare und zugleich eindeutig rueckwandelbare Form, z. B.
 * "2026-10 bis 2026-12 (aktiv); 2027-01 bis offen (aktiv)".
 */
export function stilllegungsText(
  zeitraeume: readonly MatoolStilllegungZeitraum[]
): string {
  return zeitraeume
    .map(
      (zeitraum) =>
        `${zeitraum.von} bis ${zeitraum.bis || "offen"} (${zeitraum.status})`
    )
    .join("; ");
}

const ZEITRAUM_MUSTER =
  /^(\d{4}-(?:0[1-9]|1[0-2])) bis (\d{4}-(?:0[1-9]|1[0-2])|offen) \(([^();]*)\)$/u;

/** Gegenstueck zu stilllegungsText; null bei unlesbarem Text. */
export function stilllegungenAusText(
  text: unknown
): MatoolStilllegungZeitraum[] | null {
  if (typeof text !== "string") {
    return null;
  }
  if (text.trim() === "") {
    return [];
  }
  const zeitraeume: MatoolStilllegungZeitraum[] = [];
  for (const teil of text.split("; ")) {
    const treffer = ZEITRAUM_MUSTER.exec(teil);
    if (!treffer?.[1] || !treffer[2]) {
      return null;
    }
    zeitraeume.push({
      von: treffer[1],
      bis: treffer[2] === "offen" ? "" : treffer[2],
      status: treffer[3] ?? ""
    });
  }
  return zeitraeume;
}

function numericId(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{1,32}$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function monat(monatWert: unknown, jahrWert: unknown): string | undefined {
  const monatText = zahlText(monatWert);
  const jahrText = zahlText(jahrWert);
  if (!monatText || !jahrText || !/^\d{1,2}$/u.test(monatText) || !/^\d{4}$/u.test(jahrText)) {
    return undefined;
  }
  const monatZahl = Number(monatText);
  const jahrZahl = Number(jahrText);
  if (monatZahl < 1 || monatZahl > 12 || jahrZahl < 1990 || jahrZahl > 2200) {
    return undefined;
  }
  return `${jahrText}-${String(monatZahl).padStart(2, "0")}`;
}

/** Kein Ende eingetragen: leer, "0"/"00" bzw. "0000". */
function offenesEnde(monatWert: unknown, jahrWert: unknown): boolean {
  const leer = (wert: unknown) => {
    const text = zahlText(wert);
    return text === "" || /^0+$/u.test(text ?? "x");
  };
  return (
    (monatWert === undefined || monatWert === null || leer(monatWert)) &&
    (jahrWert === undefined || jahrWert === null || leer(jahrWert))
  );
}

function zahlText(wert: unknown): string | undefined {
  if (typeof wert === "string") {
    return wert.trim();
  }
  if (typeof wert === "number" && Number.isSafeInteger(wert) && wert >= 0) {
    return String(wert);
  }
  return undefined;
}

function statusText(wert: unknown): string | undefined {
  if (wert === undefined || wert === null) {
    return "";
  }
  if (typeof wert !== "string") {
    return undefined;
  }
  const normalisiert = wert
    .replace(/[();]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("de-DE");
  return normalisiert.length <= MAX_STATUS_LENGTH ? normalisiert : undefined;
}

/** Der Formular-Eintrag eines Mitglieds ohne Stilllegung, sonst false. */
function istFormularEintrag(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const source = entry as Record<string, unknown>;
  const felder = Object.keys(source);
  const monatsliste = source.periondenarray;
  return (
    felder.length > 0 &&
    felder.every((feld) => FORMULAR_FELDER.has(feld)) &&
    optionalText(source.name) &&
    optionalText(source.zahlungsperiode) &&
    statusText(source.status) !== undefined &&
    (monatsliste === undefined ||
      monatsliste === null ||
      (Array.isArray(monatsliste) &&
        monatsliste.length <= 24 &&
        monatsliste.every(
          (monat) =>
            (typeof monat === "string" && monat.length <= 10) ||
            (typeof monat === "number" && Number.isFinite(monat))
        )))
  );
}

/** Nicht uebernommene Felder duerfen fehlen, muessen aber schlicht sein. */
function optionalText(wert: unknown): boolean {
  return (
    wert === undefined ||
    wert === null ||
    (typeof wert === "string" && wert.length <= MAX_TEXT_LENGTH) ||
    (typeof wert === "number" && Number.isFinite(wert))
  );
}

function stilllegungSchemaError(value: unknown): MatoolShapeMismatchError {
  return new MatoolShapeMismatchError(
    new AppError(
      "matool_stilllegung_schema_mismatch",
      502,
      "Die MATOOL-Stilllegungsdaten entsprechen nicht dem bestätigten Schema."
    ),
    {
      area: "schueler_stilllegungen",
      ...(value === undefined ? {} : { json: describeJsonShape(value) })
    }
  );
}
