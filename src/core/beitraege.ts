/**
 * Beitragsuebersicht der Mitglieder.
 *
 * Reine Rechenlogik ohne D1 und ohne Netz: Aus Mitgliederliste und
 * Stammdaten entsteht je Mitglied ein Monatsbeitrag, daraus die Monatssumme
 * aller nicht stillgelegten Mitglieder und eine XML-Datei fuer Zapier.
 *
 * Grundsaetze:
 * - Gerechnet wird in Cent (Ganzzahlen), nie mit Gleitkomma-Summen.
 * - Nichts wird still verworfen. Ein Mitglied ohne Stammdaten oder mit
 *   unlesbarem Beitrag landet mit Grund in `nichtEingerechnet`, und die
 *   Uebersicht gilt dann als unvollstaendig.
 * - Es verlassen ausschliesslich die hier benannten Felder den Hub. Bank-,
 *   Geburts- und Kontaktdaten der Stammdaten werden nicht einmal gelesen.
 */

export const BEITRAGS_SCHEMA_VERSION = 1;

/** Standardfelder, in denen MATOOL eine Stilllegung ausweisen kann. */
export const DEFAULT_STILLLEGUNG_FELDER = ["kundenart", "vertrag"] as const;

/**
 * Standardmuster (Teilzeichenfolgen, ohne Gross-/Kleinschreibung) fuer
 * stillgelegte Mitglieder. "stilleg" deckt die haeufige Schreibweise mit
 * zwei l ab, "stillleg" die amtliche mit drei.
 */
export const DEFAULT_STILLLEGUNG_MUSTER = [
  "stillgelegt",
  "stillleg",
  "stilleg",
  "ruhend",
  "ruhezeit",
  "pausiert"
] as const;

/**
 * Wie der MATOOL-Wert `beitrag` zu lesen ist:
 * - `monat`: Beitrag ist bereits der Monatsbetrag (Standard).
 * - `zahlungsperiode`: Beitrag ist der Betrag je Zahlungsperiode und wird
 *   auf einen Monat umgerechnet (vierteljaehrlich / 3 usw.).
 */
export type BetragsBezug = "monat" | "zahlungsperiode";

export interface BeitragsRegeln {
  betragsBezug: BetragsBezug;
  stilllegungFelder: readonly string[];
  stilllegungMuster: readonly string[];
  /**
   * Zuordnung MATOOL-Schulkennung -> Schulname. Werte, die hier nicht
   * stehen, erscheinen unveraendert.
   */
  schulen: Readonly<Record<string, string>>;
  /**
   * Stammdatenfeld mit einem abweichenden Einzugstag. Ist dort ein Tag
   * eingetragen, gilt er; sonst der Tag des Vertragsbeginns.
   */
  einzugFeld: EinzugFeld;
}

/**
 * Felder, die als Quelle fuer den abweichenden Einzugstag in Frage kommen.
 * Bewusst eine feste Liste: Die Rohwerte des gewaehlten Felds erscheinen in
 * der Feldwerte-Pruefung, deshalb darf dort nie IBAN, Geburtstag o. Ae.
 * landen.
 */
export const EINZUG_FELDER = [
  "abweichenderEinzug",
  "autPreisDatum",
  "autPreisTurnus",
  "kundenart",
  "vertrag",
  "zahlart",
  "zahlungsperiode"
] as const;
export type EinzugFeld = (typeof EINZUG_FELDER)[number];

/**
 * Woher der Einzugstag stammt: aus dem abweichenden Einzug, aus dem
 * Vertragsbeginn oder -- leer -- nirgends eindeutig lesbar.
 */
export type EinzugsQuelle = "abweichend" | "vertragsbeginn" | "";

export interface EinzugsTagSumme {
  /** Tag im Monat, 1 bis 31. */
  tag: number;
  /** Summe der Monatsbeitraege, die an diesem Tag eingezogen werden. */
  cent: number;
  /** Anzahl zahlender Mitglieder (Beitrag ungleich 0) mit diesem Tag. */
  zahler: number;
}

/**
 * Standortkennungen aus den MATOOL-Schulfiltern (Telemetrie und
 * Schuelerliste), belegt im Repository der Klassenauswertung.
 */
export const DEFAULT_SCHULEN: Readonly<Record<string, string>> = {
  "273": "Rosenheim",
  "1474": "Stephanskirchen",
  "1734": "Raubling"
};

export const DEFAULT_BEITRAGS_REGELN: BeitragsRegeln = {
  betragsBezug: "monat",
  stilllegungFelder: DEFAULT_STILLLEGUNG_FELDER,
  stilllegungMuster: DEFAULT_STILLLEGUNG_MUSTER,
  schulen: DEFAULT_SCHULEN,
  einzugFeld: "abweichenderEinzug"
};

/**
 * Felder der Mitglieder-Stammdaten, die fuer die Beitragsuebersicht gelesen
 * werden. Alles andere (IBAN, Geburtstag, Anschrift, Eltern ...) bleibt
 * unberuehrt.
 */
export const BEITRAGS_STAMMDATEN_FELDER = [
  "abweichenderEinzug",
  "beitrag",
  "jahresgebuehr",
  "jahresgebuehrdatum",
  "kundenart",
  "mitgliednr",
  "name",
  "schule",
  "spartenliste",
  "vertrag",
  "vertragsbeginn",
  "vertragsende",
  "vname",
  "zahlart",
  "zahlungsperiode"
] as const;

/**
 * Felder, deren Wertverteilung zur Regelpruefung gezeigt wird. "sparten"
 * ist kein MATOOL-Feld, sondern die aus `spartenliste` gelesenen Namen.
 */
export const BEITRAGS_FELDWERT_FELDER = [
  "kundenart",
  "vertrag",
  "zahlungsperiode",
  "zahlart",
  "schule",
  "sparten"
] as const;

export interface BeitragsQuelle {
  /** Stabile MATOOL-Mitglieds-ID. */
  sourceId: string;
  /** Felder aus der Mitgliederliste (nr, vorname, name, vertrag). */
  liste: Readonly<Record<string, unknown>>;
  /** Mitglieder-Stammdaten; null, solange sie noch nicht gelesen wurden. */
  stammdaten: Readonly<Record<string, unknown>> | null;
  /** Zeitpunkt, zu dem die Stammdaten zuletzt aus MATOOL gelesen wurden. */
  stammdatenStand: string | null;
}

export type NichtEingerechnetGrund =
  | "stillgelegt"
  | "stammdaten_fehlen"
  | "beitrag_unlesbar"
  | "zahlungsperiode_unbekannt";

export interface BeitragsPosition {
  matoolId: string;
  mitgliedsnummer: string;
  vorname: string;
  nachname: string;
  vertrag: string;
  kundenart: string;
  /** Schulname laut Zuordnung, sonst der MATOOL-Rohwert. */
  schule: string;
  /** Sparten aus `spartenliste`, alphabetisch; leer, wenn keine hinterlegt. */
  sparten: string[];
  vertragsbeginn: string;
  vertragsende: string;
  /** Einzugstag im Monat (1 bis 31); null, wenn nicht eindeutig lesbar. */
  einzugstag: number | null;
  einzugsquelle: EinzugsQuelle;
  /** Faelligkeit der Jahresgebuehr, wie in MATOOL hinterlegt. */
  jahresgebuehrdatum: string;
  zahlungsperiode: string;
  zahlart: string;
  /** Beitrag wie in MATOOL hinterlegt, in Cent. */
  beitragCent: number;
  /** Auf einen Monat gerechneter Beitrag in Cent. */
  monatsbeitragCent: number;
  /** Informativ, nicht in der Monatssumme enthalten. */
  jahresgebuehrCent: number | null;
  stammdatenStand: string | null;
}

export interface NichtEingerechnetePosition {
  matoolId: string;
  mitgliedsnummer: string;
  vorname: string;
  nachname: string;
  vertrag: string;
  kundenart: string;
  schule: string;
  sparten: string[];
  vertragsbeginn: string;
  vertragsende: string;
  einzugstag: number | null;
  einzugsquelle: EinzugsQuelle;
  jahresgebuehrdatum: string;
  grund: NichtEingerechnetGrund;
  /** Rohwert, der zum Ausschluss gefuehrt hat (z. B. der Kundenart-Text). */
  detail: string;
  /**
   * Hinterlegter Beitrag in Cent, soweit lesbar. Bei Stilllegungen zeigt er,
   * welcher Betrag gerade ruht; in keiner Summe enthalten.
   */
  beitragCent: number | null;
}

export interface BeitragsZusammenfassung {
  monatssummeCent: number;
  jahresgebuehrSummeCent: number;
  mitgliederGesamt: number;
  eingerechnet: number;
  mitBeitrag: number;
  ohneBeitrag: number;
  stillgelegt: number;
  stammdatenFehlen: number;
  nichtBerechenbar: number;
  /**
   * Ehemalige Mitglieder laut MATOOL-Liste "Kuendigung abgeschlossen";
   * null, solange diese Liste nicht gelesen wurde.
   */
  exMitglieder: number | null;
  /** Monatssumme je Einzugstag, nur Tage mit Betrag, aufsteigend. */
  einzugNachTag: EinzugsTagSumme[];
  /** Zahlende Mitglieder, deren Einzugstag nicht lesbar ist. */
  einzugUnklar: { cent: number; zahler: number };
  /**
   * true, wenn die Mitgliederliste gelesen ist und jedes nicht stillgelegte
   * Mitglied eingerechnet wurde.
   */
  vollstaendig: boolean;
  datenstandAeltester: string | null;
  datenstandNeuester: string | null;
}

export interface BeitragsUebersicht {
  schemaVersion: typeof BEITRAGS_SCHEMA_VERSION;
  erstelltAm: string;
  stichtag: string;
  waehrung: "EUR";
  regeln: BeitragsRegeln;
  zusammenfassung: BeitragsZusammenfassung;
  positionen: BeitragsPosition[];
  nichtEingerechnet: NichtEingerechnetePosition[];
}

export interface FeldwertVerteilung {
  feld: string;
  werte: Array<{ anzahl: number; wert: string }>;
}

/**
 * Erstellt die Beitragsuebersicht aus dem aktuellen Mitgliederbestand.
 * `quellen` muss genau die aktuelle Mitgliederliste abbilden.
 */
export function erstelleBeitragsUebersicht(
  quellen: readonly BeitragsQuelle[],
  optionen: {
    erstelltAm: string;
    exMitglieder?: number | null;
    regeln?: BeitragsRegeln;
    stichtag: string;
  }
): BeitragsUebersicht {
  const regeln = optionen.regeln ?? DEFAULT_BEITRAGS_REGELN;
  const positionen: BeitragsPosition[] = [];
  const nichtEingerechnet: NichtEingerechnetePosition[] = [];
  const staende: string[] = [];

  for (const quelle of quellen) {
    const person = personAngaben(quelle, regeln);
    const beitragCent =
      quelle.stammdaten === null ? null : parseEuroCent(quelle.stammdaten.beitrag);
    const stilllegung = erkenneStilllegung(quelle, regeln);
    if (stilllegung !== null) {
      nichtEingerechnet.push({
        ...person,
        grund: "stillgelegt",
        detail: stilllegung,
        beitragCent
      });
      continue;
    }

    if (quelle.stammdaten === null) {
      nichtEingerechnet.push({
        ...person,
        grund: "stammdaten_fehlen",
        detail: "Stammdaten wurden noch nicht aus MATOOL gelesen.",
        beitragCent: null
      });
      continue;
    }
    if (quelle.stammdatenStand) {
      staende.push(quelle.stammdatenStand);
    }

    const beitragRoh = textWert(quelle.stammdaten.beitrag);
    if (beitragCent === null) {
      nichtEingerechnet.push({
        ...person,
        grund: "beitrag_unlesbar",
        detail: beitragRoh,
        beitragCent: null
      });
      continue;
    }

    const zahlungsperiode = textWert(quelle.stammdaten.zahlungsperiode);
    let monatsbeitragCent = beitragCent;
    if (regeln.betragsBezug === "zahlungsperiode" && beitragCent !== 0) {
      const monate = zahlungsperiodeInMonaten(quelle.stammdaten.zahlungsperiode);
      if (monate === null) {
        nichtEingerechnet.push({
          ...person,
          grund: "zahlungsperiode_unbekannt",
          detail: zahlungsperiode,
          beitragCent
        });
        continue;
      }
      monatsbeitragCent = Math.round(beitragCent / monate);
    }

    positionen.push({
      ...person,
      zahlungsperiode,
      zahlart: textWert(quelle.stammdaten.zahlart),
      beitragCent,
      monatsbeitragCent,
      jahresgebuehrCent: parseEuroCent(quelle.stammdaten.jahresgebuehr),
      stammdatenStand: quelle.stammdatenStand
    });
  }

  positionen.sort(vergleichePersonen);
  nichtEingerechnet.sort(
    (links, rechts) =>
      GRUND_REIHENFOLGE[links.grund] - GRUND_REIHENFOLGE[rechts.grund] ||
      vergleichePersonen(links, rechts)
  );
  staende.sort();

  const zaehle = (grund: NichtEingerechnetGrund) =>
    nichtEingerechnet.filter((eintrag) => eintrag.grund === grund).length;
  const stillgelegt = zaehle("stillgelegt");
  const stammdatenFehlen = zaehle("stammdaten_fehlen");
  const nichtBerechenbar =
    zaehle("beitrag_unlesbar") + zaehle("zahlungsperiode_unbekannt");
  const mitBeitrag = positionen.filter(
    (position) => position.monatsbeitragCent !== 0
  ).length;
  const zahlende = positionen.filter((position) => position.monatsbeitragCent !== 0);
  const tage = new Map<number, EinzugsTagSumme>();
  for (const position of zahlende) {
    if (position.einzugstag === null) {
      continue;
    }
    const eintrag = tage.get(position.einzugstag) ?? { tag: position.einzugstag, cent: 0, zahler: 0 };
    eintrag.cent += position.monatsbeitragCent;
    eintrag.zahler += 1;
    tage.set(position.einzugstag, eintrag);
  }
  const unklar = zahlende.filter((position) => position.einzugstag === null);

  return {
    schemaVersion: BEITRAGS_SCHEMA_VERSION,
    erstelltAm: optionen.erstelltAm,
    stichtag: optionen.stichtag,
    waehrung: "EUR",
    regeln,
    zusammenfassung: {
      monatssummeCent: positionen.reduce(
        (summe, position) => summe + position.monatsbeitragCent,
        0
      ),
      jahresgebuehrSummeCent: positionen.reduce(
        (summe, position) => summe + (position.jahresgebuehrCent ?? 0),
        0
      ),
      mitgliederGesamt: quellen.length,
      eingerechnet: positionen.length,
      mitBeitrag,
      ohneBeitrag: positionen.length - mitBeitrag,
      stillgelegt,
      stammdatenFehlen,
      nichtBerechenbar,
      exMitglieder: optionen.exMitglieder ?? null,
      einzugNachTag: [...tage.values()].sort((links, rechts) => links.tag - rechts.tag),
      einzugUnklar: { cent: summe(unklar), zahler: unklar.length },
      // Ohne gelesene Mitgliederliste waere eine Summe von 0 irrefuehrend.
      vollstaendig:
        quellen.length > 0 && stammdatenFehlen === 0 && nichtBerechenbar === 0,
      datenstandAeltester: staende[0] ?? null,
      datenstandNeuester: staende.at(-1) ?? null
    },
    positionen,
    nichtEingerechnet
  };
}

function summe(positionen: readonly BeitragsPosition[]): number {
  return positionen.reduce((gesamt, position) => gesamt + position.monatsbeitragCent, 0);
}

const GRUND_REIHENFOLGE: Readonly<Record<NichtEingerechnetGrund, number>> = {
  beitrag_unlesbar: 0,
  zahlungsperiode_unbekannt: 1,
  stammdaten_fehlen: 2,
  stillgelegt: 3
};

const personenSortierung = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base"
});

function vergleichePersonen(
  links: { matoolId: string; nachname: string; vorname: string },
  rechts: { matoolId: string; nachname: string; vorname: string }
): number {
  return (
    personenSortierung.compare(links.nachname, rechts.nachname) ||
    personenSortierung.compare(links.vorname, rechts.vorname) ||
    personenSortierung.compare(links.matoolId, rechts.matoolId)
  );
}

function personAngaben(
  quelle: BeitragsQuelle,
  regeln: BeitragsRegeln
): {
  kundenart: string;
  matoolId: string;
  mitgliedsnummer: string;
  nachname: string;
  schule: string;
  sparten: string[];
  vertrag: string;
  vertragsbeginn: string;
  vertragsende: string;
  einzugstag: number | null;
  einzugsquelle: EinzugsQuelle;
  jahresgebuehrdatum: string;
  vorname: string;
} {
  const stammdaten = quelle.stammdaten ?? {};
  return {
    matoolId: quelle.sourceId,
    mitgliedsnummer: ersterText(stammdaten.mitgliednr, quelle.liste.nr),
    vorname: ersterText(stammdaten.vname, quelle.liste.vorname),
    nachname: ersterText(stammdaten.name, quelle.liste.name),
    vertrag: ersterText(stammdaten.vertrag, quelle.liste.vertrag),
    kundenart: textWert(stammdaten.kundenart),
    schule: schulName(stammdaten.schule, regeln.schulen),
    sparten: spartenAus(stammdaten.spartenliste),
    vertragsbeginn: textWert(stammdaten.vertragsbeginn),
    vertragsende: textWert(stammdaten.vertragsende),
    // Ohne Stammdaten ist auch der Einzugstag unbekannt.
    ...(quelle.stammdaten === null
      ? { einzugstag: null, einzugsquelle: "" as const }
      : einzugAus(stammdaten, regeln.einzugFeld)),
    jahresgebuehrdatum: textWert(stammdaten.jahresgebuehrdatum)
  };
}

const NEIN_WERTE = new Set(["", "0", "nein", "n", "false", "off", "no", "-"]);

/**
 * Bestimmt den Einzugstag eines Mitglieds.
 *
 * 1. Ist im Feld fuer den abweichenden Einzug ein Tag eingetragen (Zahl,
 *    "zum 7.", "07.03.", "2026-03-07"), gilt dieser Tag.
 * 2. Sonst gilt der Tag des Vertragsbeginns. Neuere Vertraege beginnen am
 *    1. oder 15.; aeltere auch an anderen Tagen und werden dann an diesem
 *    Tag eingezogen.
 *
 * Ist ein abweichender Einzug gesetzt, aber ohne lesbaren Tag (nur ein
 * Haekchen), bleibt der Tag leer statt auf den Vertragsbeginn zu fallen:
 * Dann weicht der Einzug ja gerade davon ab.
 */
export function einzugAus(
  stammdaten: Readonly<Record<string, unknown>>,
  feld: string = DEFAULT_BEITRAGS_REGELN.einzugFeld
): { einzugstag: number | null; einzugsquelle: EinzugsQuelle } {
  const abweichend = stammdaten[feld];
  const abweichendText = normalisiereVergleich(textWert(abweichend));
  const nichtGesetzt =
    abweichend === null ||
    abweichend === undefined ||
    abweichend === false ||
    abweichend === 0 ||
    NEIN_WERTE.has(abweichendText);
  if (!nichtGesetzt) {
    return { einzugstag: tagImMonat(abweichend), einzugsquelle: "abweichend" };
  }
  const tag = tagImMonat(stammdaten.vertragsbeginn);
  return tag === null
    ? { einzugstag: null, einzugsquelle: "" }
    : { einzugstag: tag, einzugsquelle: "vertragsbeginn" };
}

/**
 * Tag im Monat aus einer Zahl oder einem Datum: 7, "7", "zum 7.", "07.03.",
 * "07.03.2026", "2026-03-07", "2026-03-07 00:00:00". Liefert null fuer alles
 * andere, auch fuer Nulldaten wie "0000-00-00".
 */
export function tagImMonat(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null;
  }
  const text = normalisiereVergleich(textWert(value));
  const tag =
    /^\d{4}-\d{2}-(\d{2})(?:$|[t\s])/u.exec(text)?.[1] ??
    /^(\d{1,2})\.\d{1,2}\.(?:\d{2,4})?$/u.exec(text)?.[1] ??
    /^(?:zum\s+|am\s+)?(\d{1,2})\.?$/u.exec(text)?.[1];
  const zahl = tag === undefined ? Number.NaN : Number(tag);
  return Number.isInteger(zahl) && zahl >= 1 && zahl <= 31 ? zahl : null;
}

/**
 * Schulname zu einer MATOOL-Schulkennung. Unbekannte Werte bleiben
 * unveraendert stehen, damit nichts still falsch zugeordnet wird.
 */
export function schulName(
  value: unknown,
  schulen: Readonly<Record<string, string>> = DEFAULT_SCHULEN
): string {
  const text = textWert(value);
  return Object.hasOwn(schulen, text) ? (schulen[text] ?? text) : text;
}

/** Schluessel, unter denen MATOOL-Objekte ihren Anzeigenamen fuehren. */
const SPARTEN_NAMENSFELDER = [
  "name",
  "bezeichnung",
  "sparte",
  "titel",
  "label",
  "kurzname",
  "text"
] as const;

/**
 * Liest die Sparten eines Mitglieds aus `spartenliste`. MATOOL liefert das
 * Feld als Text oder als Liste/Objekt (im Hub als kanonisches JSON
 * gespeichert). Verstanden werden:
 * - Text, getrennt durch Komma, Semikolon, senkrechten Strich oder Umbruch;
 * - JSON-Listen aus Texten oder aus Objekten mit Namensfeld;
 * - JSON-Objekte mit Namen als Werten ({"3": "Kickboxen"}) oder mit
 *   Namen als Schluesseln und Ja/Nein-Werten ({"Kickboxen": 1}).
 * Was keinem Muster folgt, wird ausgelassen statt geraten; die Verteilung
 * unter "Regeln und Feldwerte" zeigt, was tatsaechlich gelesen wurde.
 */
export function spartenAus(value: unknown): string[] {
  let roh: unknown = value;
  if (typeof roh === "string") {
    const text = roh.trim();
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        roh = JSON.parse(text) as unknown;
      } catch {
        roh = text;
      }
    } else {
      roh = text;
    }
  }

  const namen: string[] = [];
  if (typeof roh === "string") {
    namen.push(...roh.split(/[,;|\n]/u));
  } else if (typeof roh === "number") {
    namen.push(String(roh));
  } else if (Array.isArray(roh)) {
    for (const eintrag of roh) {
      namen.push(spartenEintragName(eintrag));
    }
  } else if (roh !== null && typeof roh === "object") {
    const eintraege = Object.entries(roh as Record<string, unknown>);
    const nurSchalter = eintraege.every(
      ([, wert]) =>
        typeof wert === "boolean" ||
        typeof wert === "number" ||
        wert === null ||
        (typeof wert === "string" && /^(?:0|1|ja|nein|true|false)?$/iu.test(wert.trim()))
    );
    for (const [schluessel, wert] of eintraege) {
      if (nurSchalter) {
        if (istJa(wert)) {
          namen.push(schluessel);
        }
      } else {
        namen.push(spartenEintragName(wert));
      }
    }
  }

  return [
    ...new Set(
      namen
        .map((name) => name.normalize("NFKC").replace(/\s+/gu, " ").trim())
        .filter((name) => name.length > 0)
    )
  ].sort((links, rechts) => personenSortierung.compare(links, rechts));
}

function spartenEintragName(eintrag: unknown): string {
  if (typeof eintrag === "string") {
    return eintrag;
  }
  if (typeof eintrag === "number") {
    return String(eintrag);
  }
  if (eintrag !== null && typeof eintrag === "object" && !Array.isArray(eintrag)) {
    const objekt = eintrag as Record<string, unknown>;
    for (const feld of SPARTEN_NAMENSFELDER) {
      const text = textWert(objekt[feld]);
      if (text.length > 0) {
        return text;
      }
    }
  }
  return "";
}

function istJa(wert: unknown): boolean {
  if (typeof wert === "boolean") {
    return wert;
  }
  if (typeof wert === "number") {
    return wert !== 0;
  }
  return typeof wert === "string" && /^(?:1|ja|true)$/iu.test(wert.trim());
}

/**
 * Liefert den Rohwert, der eine Stilllegung belegt, oder null. Geprueft
 * werden die konfigurierten Felder in Stammdaten und Mitgliederliste.
 *
 * Ein Muster trifft als Teilzeichenfolge ("stillgelegt" trifft auch
 * "Vertrag stillgelegt"). Mit vorangestelltem "=" muss der ganze Wert
 * passen; das ist fuer Codes wie Kundenart "=3" gedacht, damit "3" nicht
 * auch "13" trifft.
 */
export function erkenneStilllegung(
  quelle: BeitragsQuelle,
  regeln: BeitragsRegeln = DEFAULT_BEITRAGS_REGELN
): string | null {
  const muster = regeln.stilllegungMuster
    .map((eintrag) => {
      const exakt = eintrag.trimStart().startsWith("=");
      return {
        exakt,
        text: normalisiereVergleich(exakt ? eintrag.trimStart().slice(1) : eintrag)
      };
    })
    .filter((eintrag) => eintrag.text.length > 0);
  if (muster.length === 0) {
    return null;
  }
  for (const feld of regeln.stilllegungFelder) {
    for (const wert of [quelle.stammdaten?.[feld], quelle.liste[feld]]) {
      const text = textWert(wert);
      const vergleich = normalisiereVergleich(text);
      if (
        vergleich.length > 0 &&
        muster.some((eintrag) =>
          eintrag.exakt ? vergleich === eintrag.text : vergleich.includes(eintrag.text)
        )
      ) {
        return `${feld}: ${text}`;
      }
    }
  }
  return null;
}

/**
 * Liest die Regeln aus den Worker-Variablen. Fehlende oder leere Werte
 * fallen auf die Standardregeln zurueck; ein ungueltiger Betragsbezug ist
 * ein Konfigurationsfehler und wird nicht still ersetzt.
 */
export function beitragsRegelnAusUmgebung(werte: {
  BEITRAEGE_BETRAGSBEZUG?: string | undefined;
  BEITRAEGE_EINZUG_FELD?: string | undefined;
  BEITRAEGE_SCHULEN?: string | undefined;
  BEITRAEGE_STILLLEGUNG_FELDER?: string | undefined;
  BEITRAEGE_STILLLEGUNG_MUSTER?: string | undefined;
}): BeitragsRegeln {
  const bezug = (werte.BEITRAEGE_BETRAGSBEZUG ?? "").trim();
  if (bezug !== "" && bezug !== "monat" && bezug !== "zahlungsperiode") {
    throw new Error("BEITRAEGE_BETRAGSBEZUG muss 'monat' oder 'zahlungsperiode' sein.");
  }
  const liste = (wert: string | undefined): string[] =>
    (wert ?? "")
      .split(/[,;\n]/u)
      .map((eintrag) => eintrag.trim())
      .filter((eintrag) => eintrag.length > 0);
  const felder = liste(werte.BEITRAEGE_STILLLEGUNG_FELDER);
  if (felder.some((feld) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(feld))) {
    throw new Error("BEITRAEGE_STILLLEGUNG_FELDER enthaelt einen ungueltigen Feldnamen.");
  }
  const muster = liste(werte.BEITRAEGE_STILLLEGUNG_MUSTER);
  const schulen: Record<string, string> = {};
  for (const eintrag of liste(werte.BEITRAEGE_SCHULEN)) {
    const trenner = eintrag.indexOf("=");
    const kennung = trenner > 0 ? eintrag.slice(0, trenner).trim() : "";
    const name = trenner > 0 ? eintrag.slice(trenner + 1).trim() : "";
    if (kennung.length === 0 || name.length === 0 || Object.hasOwn(schulen, kennung)) {
      throw new Error(
        "BEITRAEGE_SCHULEN erwartet eindeutige Paare 'Kennung=Name', z. B. '273=Rosenheim'."
      );
    }
    schulen[kennung] = name;
  }
  const einzugFeld = (werte.BEITRAEGE_EINZUG_FELD ?? "").trim();
  if (einzugFeld !== "" && !(EINZUG_FELDER as readonly string[]).includes(einzugFeld)) {
    throw new Error(
      `BEITRAEGE_EINZUG_FELD muss eines dieser Felder sein: ${EINZUG_FELDER.join(", ")}.`
    );
  }
  return {
    einzugFeld:
      einzugFeld === "" ? DEFAULT_BEITRAGS_REGELN.einzugFeld : (einzugFeld as EinzugFeld),
    betragsBezug: bezug === "" ? DEFAULT_BEITRAGS_REGELN.betragsBezug : bezug,
    stilllegungFelder: felder.length > 0 ? felder : DEFAULT_BEITRAGS_REGELN.stilllegungFelder,
    stilllegungMuster: muster.length > 0 ? muster : DEFAULT_BEITRAGS_REGELN.stilllegungMuster,
    schulen: Object.keys(schulen).length > 0 ? schulen : DEFAULT_BEITRAGS_REGELN.schulen
  };
}

function normalisiereVergleich(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Liest einen Eurobetrag in Cent. Versteht Zahlen sowie deutsche und
 * englische Schreibweisen mit oder ohne Waehrungszeichen:
 * "49,90", "49.90", "1.234,56 €", "EUR 12", "-". Leerwerte gelten als 0.
 * Liefert null, wenn der Wert kein eindeutiger Betrag ist.
 */
export function parseEuroCent(value: unknown): number | null {
  if (value === null || value === undefined || value === false) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  let text = value
    .normalize("NFKC")
    .replace(/(?:€|eur(?:o)?)/giu, "")
    .replace(/[\s\u{A0}\u{202F}']/gu, "");
  if (text.length === 0 || /^[-–—]+$/u.test(text)) {
    return 0;
  }

  let negativ = false;
  if (text.startsWith("-")) {
    negativ = true;
    text = text.slice(1);
  }
  // Schreibweise ",-" bzw. ".-" fuer volle Eurobetraege.
  text = text.replace(/[.,][-–]$/u, "");

  const letztesKomma = text.lastIndexOf(",");
  const letzterPunkt = text.lastIndexOf(".");
  let ganz: string;
  let nachkomma: string;
  if (letztesKomma >= 0 && letzterPunkt >= 0) {
    const trenner = Math.max(letztesKomma, letzterPunkt);
    const tausender = trenner === letztesKomma ? "." : ",";
    ganz = text.slice(0, trenner);
    nachkomma = text.slice(trenner + 1);
    if (!tausenderGruppiert(ganz, tausender)) {
      return null;
    }
    ganz = ganz.split(tausender).join("");
  } else if (letztesKomma >= 0 || letzterPunkt >= 0) {
    const trenner = letztesKomma >= 0 ? "," : ".";
    const teile = text.split(trenner);
    const letzter = teile.at(-1) ?? "";
    if (teile.length > 2 || (letzter.length === 3 && teile.length === 2 && trenner === ".")) {
      // "1.234" oder "1.234.567": Punkte als Tausendertrennung.
      if (!teile.every((teil, index) => index === 0 ? /^\d{1,3}$/u.test(teil) : /^\d{3}$/u.test(teil))) {
        return null;
      }
      ganz = teile.join("");
      nachkomma = "";
    } else {
      ganz = teile[0] ?? "";
      nachkomma = letzter;
    }
  } else {
    ganz = text;
    nachkomma = "";
  }

  if (!/^\d{1,9}$/u.test(ganz) || !/^\d{0,2}$/u.test(nachkomma)) {
    return null;
  }
  const cent = Number(ganz) * 100 + Number(nachkomma.padEnd(2, "0") || "0");
  return negativ ? -cent : cent;
}

function tausenderGruppiert(ganz: string, trenner: string): boolean {
  const teile = ganz.split(trenner);
  return teile.every((teil, index) =>
    index === 0 ? /^\d{1,3}$/u.test(teil) || teile.length === 1 : /^\d{3}$/u.test(teil)
  );
}

/**
 * Ordnet eine MATOOL-Zahlungsperiode ihrer Laenge in Monaten zu. Liefert
 * null fuer unbekannte Werte; es wird nicht geraten.
 */
export function zahlungsperiodeInMonaten(value: unknown): number | null {
  const text = normalisiereVergleich(textWert(value));
  if (text.length === 0) {
    return null;
  }
  const zahl = /^(\d{1,2})(?:\s*-?\s*monat\S*)?$|^alle\s+(\d{1,2})\s+monat/u.exec(
    text
  );
  if (zahl) {
    const monate = Number(zahl[1] ?? zahl[2]);
    return GUELTIGE_PERIODEN.has(monate) ? monate : null;
  }
  if (/halbj|halbes jahr|halbjahr|semest/u.test(text)) {
    return 6;
  }
  if (/viertelj|quartal/u.test(text)) {
    return 3;
  }
  if (/zweimonat/u.test(text)) {
    return 2;
  }
  if (/j(?:ä|ae|a)hrl|^jahr|pro jahr/u.test(text)) {
    return 12;
  }
  if (/^monat|monatl|pro monat/u.test(text)) {
    return 1;
  }
  return null;
}

const GUELTIGE_PERIODEN = new Set([1, 2, 3, 6, 12]);

/**
 * Zaehlt, welche Werte die fuer die Regeln relevanten Felder im aktuellen
 * Bestand haben. Das Dashboard zeigt damit, woran eine Stilllegung zu
 * erkennen ist, ohne einzelne Personen offenzulegen.
 */
export function zaehleFeldwerte(
  quellen: readonly BeitragsQuelle[],
  felder: readonly string[] = BEITRAGS_FELDWERT_FELDER
): FeldwertVerteilung[] {
  return felder.map((feld) => {
    const zaehler = new Map<string, number>();
    for (const quelle of quellen) {
      // Sparten werden einzeln gezaehlt; ein Mitglied kann mehrere haben.
      const werte =
        feld === "sparten"
          ? spartenAus(quelle.stammdaten?.spartenliste)
          : [textWert(quelle.stammdaten?.[feld] ?? quelle.liste[feld])];
      for (const wert of werte.length > 0 ? werte : [""]) {
        const schluessel = wert.length > 0 ? wert : "(leer)";
        zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
      }
    }
    return {
      feld,
      werte: [...zaehler.entries()]
        .map(([wert, anzahl]) => ({ anzahl, wert }))
        .sort(
          (links, rechts) =>
            rechts.anzahl - links.anzahl ||
            personenSortierung.compare(links.wert, rechts.wert)
        )
    };
  });
}

function ersterText(...werte: unknown[]): string {
  for (const wert of werte) {
    const text = textWert(wert);
    if (text.length > 0) {
      return text;
    }
  }
  return "";
}

function textWert(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** Cent als "1234.56" fuer XML und maschinelle Weiterverarbeitung. */
export function centAlsDezimal(cent: number): string {
  const negativ = cent < 0;
  const betrag = Math.abs(Math.trunc(cent));
  const euro = Math.floor(betrag / 100);
  const rest = String(betrag % 100).padStart(2, "0");
  return `${negativ ? "-" : ""}${euro}.${rest}`;
}

const euroFormat = new Intl.NumberFormat("de-DE", {
  currency: "EUR",
  style: "currency"
});

/** Cent als "1.234,56 €" fuer Menschen, etwa im E-Mail-Text. */
export function centAlsEuroText(cent: number): string {
  return euroFormat.format(cent / 100);
}

/** Dateiname der XML-Datei, z. B. beitragsuebersicht_2026-10-01.xml. */
export function beitragsDateiname(stichtag: string): string {
  return `beitragsuebersicht_${stichtag}.xml`;
}

/**
 * Erzeugt die XML-Datei. Aufbau: Zusammenfassung, eingerechnete Mitglieder,
 * danach alle nicht eingerechneten mit Grund. Betraege mit Punkt als
 * Dezimaltrenner, damit Tabellen und Buchhaltung sie direkt lesen.
 */
export function beitragsUebersichtAlsXml(
  uebersicht: BeitragsUebersicht
): string {
  const z = uebersicht.zusammenfassung;
  const zeilen: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<beitragsuebersicht${attribute({
      version: String(uebersicht.schemaVersion),
      erstellt_am: uebersicht.erstelltAm,
      stichtag: uebersicht.stichtag,
      waehrung: uebersicht.waehrung
    })}>`,
    "  <zusammenfassung>",
    element(4, "monatssumme", centAlsDezimal(z.monatssummeCent)),
    element(4, "jahresgebuehr_summe", centAlsDezimal(z.jahresgebuehrSummeCent)),
    element(4, "anzahl_mitglieder_gesamt", String(z.mitgliederGesamt)),
    element(4, "anzahl_eingerechnet", String(z.eingerechnet)),
    element(4, "anzahl_mit_beitrag", String(z.mitBeitrag)),
    element(4, "anzahl_ohne_beitrag", String(z.ohneBeitrag)),
    element(4, "anzahl_stillgelegt", String(z.stillgelegt)),
    element(4, "anzahl_stammdaten_fehlen", String(z.stammdatenFehlen)),
    element(4, "anzahl_nicht_berechenbar", String(z.nichtBerechenbar)),
    element(4, "vollstaendig", String(z.vollstaendig)),
    element(4, "datenstand_aeltester", z.datenstandAeltester ?? ""),
    element(4, "datenstand_neuester", z.datenstandNeuester ?? ""),
    element(4, "betragsbezug", uebersicht.regeln.betragsBezug),
    "  </zusammenfassung>",
    `  <mitglieder anzahl="${z.eingerechnet}">`
  ];

  for (const position of uebersicht.positionen) {
    zeilen.push(
      `    <mitglied${attribute({
        matool_id: position.matoolId,
        mitgliedsnummer: position.mitgliedsnummer
      })}>`,
      element(6, "vorname", position.vorname),
      element(6, "nachname", position.nachname),
      element(6, "vertrag", position.vertrag),
      element(6, "kundenart", position.kundenart),
      element(6, "zahlungsperiode", position.zahlungsperiode),
      element(6, "zahlart", position.zahlart),
      element(6, "beitrag", centAlsDezimal(position.beitragCent)),
      element(6, "monatsbeitrag", centAlsDezimal(position.monatsbeitragCent)),
      ...(position.jahresgebuehrCent !== null && position.jahresgebuehrCent !== 0
        ? [element(6, "jahresgebuehr", centAlsDezimal(position.jahresgebuehrCent))]
        : []),
      "    </mitglied>"
    );
  }
  zeilen.push(
    "  </mitglieder>",
    `  <nicht_eingerechnet anzahl="${uebersicht.nichtEingerechnet.length}">`
  );
  for (const eintrag of uebersicht.nichtEingerechnet) {
    zeilen.push(
      `    <mitglied${attribute({
        matool_id: eintrag.matoolId,
        mitgliedsnummer: eintrag.mitgliedsnummer,
        grund: eintrag.grund
      })}>`,
      element(6, "vorname", eintrag.vorname),
      element(6, "nachname", eintrag.nachname),
      element(6, "vertrag", eintrag.vertrag),
      element(6, "kundenart", eintrag.kundenart),
      element(6, "detail", eintrag.detail),
      "    </mitglied>"
    );
  }
  zeilen.push("  </nicht_eingerechnet>", "</beitragsuebersicht>", "");
  return zeilen.join("\n");
}

function element(einzug: number, name: string, wert: string): string {
  return `${" ".repeat(einzug)}<${name}>${xmlText(wert)}</${name}>`;
}

function attribute(werte: Readonly<Record<string, string>>): string {
  return Object.entries(werte)
    .map(([name, wert]) => ` ${name}="${xmlText(wert)}"`)
    .join("");
}

/**
 * Maskiert Text fuer XML 1.0. Zeichen, die XML gar nicht erlaubt
 * (Steuerzeichen ausser Tab, Zeilenumbruch, Wagenruecklauf), werden
 * entfernt, damit die Datei immer gueltig bleibt.
 */
export function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
