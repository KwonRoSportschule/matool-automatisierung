import { describe, expect, it } from "vitest";

import {
  beitragsRegelnAusUmgebung,
  beitragsUebersichtAlsXml,
  centAlsDezimal,
  centAlsEuroText,
  DEFAULT_BEITRAGS_REGELN,
  erkenneStilllegung,
  erstelleBeitragsUebersicht,
  einzugAus,
  parseEuroCent,
  schulName,
  spartenAus,
  tagImMonat,
  xmlText,
  zaehleFeldwerte,
  zahlungsperiodeInMonaten,
  type BeitragsQuelle
} from "../src/core/beitraege";

// Vollstaendig synthetische Mitglieder; keine realen Namen oder Kennungen.
function mitglied(
  sourceId: string,
  stammdaten: Record<string, unknown> | null,
  liste: Record<string, unknown> = {}
): BeitragsQuelle {
  return {
    sourceId,
    liste: {
      nr: `M-${sourceId}`,
      vorname: `Vorname${sourceId}`,
      name: `Nachname${sourceId}`,
      vertrag: "Beispielvertrag",
      ...liste
    },
    stammdaten,
    stammdatenStand: stammdaten ? `2026-09-2${sourceId.length}T08:00:00.000Z` : null
  };
}

const optionen = {
  erstelltAm: "2026-10-01T05:00:00.000Z",
  stichtag: "2026-10-01"
};

describe("parseEuroCent", () => {
  it.each([
    ["49,90", 4990],
    ["49,9", 4990],
    ["49.90", 4990],
    ["49", 4900],
    ["49,-", 4900],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.234", 123400],
    ["12,50 €", 1250],
    ["€ 12,50", 1250],
    ["EUR 12", 1200],
    ["0,00", 0],
    ["", 0],
    ["-", 0],
    ["-10,00", -1000],
    [49.9, 4990],
    [0, 0],
    [null, 0]
  ])("liest %j als %i Cent", (eingabe, cent) => {
    expect(parseEuroCent(eingabe)).toBe(cent);
  });

  it.each(["abc", "1,234", "12,345", "1.2.3", "49,999", [49]])(
    "verweigert den mehrdeutigen Wert %j",
    (eingabe) => {
      expect(parseEuroCent(eingabe)).toBeNull();
    }
  );
});

describe("zahlungsperiodeInMonaten", () => {
  it.each([
    ["monatlich", 1],
    ["Monat", 1],
    ["1", 1],
    ["vierteljährlich", 3],
    ["Quartal", 3],
    ["3 Monate", 3],
    ["alle 2 Monate", 2],
    ["halbjährlich", 6],
    ["Halbjahr", 6],
    ["jährlich", 12],
    ["jaehrlich", 12],
    ["12", 12]
  ])("ordnet %j %i Monaten zu", (eingabe, monate) => {
    expect(zahlungsperiodeInMonaten(eingabe)).toBe(monate);
  });

  it.each(["", "7", "woechentlich", "unbekannt"])(
    "raet bei %j nicht",
    (eingabe) => {
      expect(zahlungsperiodeInMonaten(eingabe)).toBeNull();
    }
  );
});

describe("erkenneStilllegung", () => {
  it("findet Stilllegungen in Kundenart oder Vertrag", () => {
    expect(
      erkenneStilllegung(mitglied("1", { kundenart: "Stillgelegt", beitrag: "40" }))
    ).toBe("kundenart: Stillgelegt");
    expect(
      erkenneStilllegung(mitglied("2", { vertrag: "Vertrag ruhend", beitrag: "40" }))
    ).toBe("vertrag: Vertrag ruhend");
    expect(
      erkenneStilllegung(mitglied("3", null, { vertrag: "Stilllegung 3 Monate" }))
    ).toBe("vertrag: Stilllegung 3 Monate");
  });

  it("laesst aktive Mitglieder unberuehrt", () => {
    expect(
      erkenneStilllegung(mitglied("4", { kundenart: "Mitglied", vertrag: "Kinder 12 Monate" }))
    ).toBeNull();
  });

  it("vergleicht mit = den ganzen Wert", () => {
    const regeln = { ...DEFAULT_BEITRAGS_REGELN, stilllegungMuster: ["=3"] };
    expect(erkenneStilllegung(mitglied("5", { kundenart: "3" }), regeln)).toBe("kundenart: 3");
    expect(erkenneStilllegung(mitglied("6", { kundenart: "13" }), regeln)).toBeNull();
  });
});

describe("beitragsRegelnAusUmgebung", () => {
  it("nutzt ohne Angaben die Standardregeln", () => {
    expect(beitragsRegelnAusUmgebung({})).toEqual(DEFAULT_BEITRAGS_REGELN);
  });

  it("liest Listen und den Betragsbezug", () => {
    expect(
      beitragsRegelnAusUmgebung({
        BEITRAEGE_BETRAGSBEZUG: "zahlungsperiode",
        BEITRAEGE_SCHULEN: "1=Nord, 2 = Sued",
        BEITRAEGE_STILLLEGUNG_FELDER: "kundenart, status",
        BEITRAEGE_STILLLEGUNG_MUSTER: "ruhend;=S"
      })
    ).toEqual({
      betragsBezug: "zahlungsperiode",
      einzugFeld: "abweichenderEinzug",
      schulen: { "1": "Nord", "2": "Sued" },
      stilllegungFelder: ["kundenart", "status"],
      stilllegungMuster: ["ruhend", "=S"]
    });
  });

  it("lehnt ungueltige Werte ab", () => {
    expect(() => beitragsRegelnAusUmgebung({ BEITRAEGE_BETRAGSBEZUG: "woche" })).toThrow();
    expect(() =>
      beitragsRegelnAusUmgebung({ BEITRAEGE_STILLLEGUNG_FELDER: "kunden-art" })
    ).toThrow();
    expect(() => beitragsRegelnAusUmgebung({ BEITRAEGE_SCHULEN: "Rosenheim" })).toThrow();
    expect(() => beitragsRegelnAusUmgebung({ BEITRAEGE_SCHULEN: "1=A,1=B" })).toThrow();
    // Das Faelligkeitsfeld ist auf eine feste Liste begrenzt, damit seine
    // Rohwerte nie Bank- oder Geburtsdaten offenlegen.
    expect(() => beitragsRegelnAusUmgebung({ BEITRAEGE_EINZUG_FELD: "iban" })).toThrow();
    expect(beitragsRegelnAusUmgebung({ BEITRAEGE_EINZUG_FELD: "zahlart" }).einzugFeld).toBe("zahlart");
  });
});

describe("schulName", () => {
  it("ordnet bekannte Kennungen zu und laesst Unbekanntes stehen", () => {
    expect(schulName("273")).toBe("Rosenheim");
    expect(schulName(1734)).toBe("Raubling");
    expect(schulName("Teststandort")).toBe("Teststandort");
    expect(schulName("")).toBe("");
    expect(schulName("7", { "7": "Synthetisch" })).toBe("Synthetisch");
  });
});

describe("einzugAus", () => {
  it.each([
    [{ abweichenderEinzug: "7", vertragsbeginn: "2020-03-22" }, 7, "abweichend"],
    [{ abweichenderEinzug: 22, vertragsbeginn: "2026-01-01" }, 22, "abweichend"],
    [{ abweichenderEinzug: "zum 15.", vertragsbeginn: "" }, 15, "abweichend"],
    [{ abweichenderEinzug: "2026-10-03" }, 3, "abweichend"],
    [{ abweichenderEinzug: false, vertragsbeginn: "2019-05-23" }, 23, "vertragsbeginn"],
    [{ abweichenderEinzug: "", vertragsbeginn: "15.04.2025" }, 15, "vertragsbeginn"],
    [{ abweichenderEinzug: "0", vertragsbeginn: "2026-02-01 00:00:00" }, 1, "vertragsbeginn"],
    [{ abweichenderEinzug: null, vertragsbeginn: "0000-00-00" }, null, ""],
    [{ vertragsbeginn: "" }, null, ""],
    // Haekchen ohne Tag: bewusst unklar statt Vertragsbeginn.
    [{ abweichenderEinzug: true, vertragsbeginn: "2026-01-01" }, null, "abweichend"],
    [{ abweichenderEinzug: "32", vertragsbeginn: "2026-01-01" }, null, "abweichend"]
  ])("liest %j", (stammdaten, tag, quelle) => {
    expect(einzugAus(stammdaten)).toEqual({ einzugstag: tag, einzugsquelle: quelle });
  });

  it("nutzt ein anderes Feld fuer den abweichenden Einzug, wenn eingestellt", () => {
    expect(einzugAus({ zahlart: "Lastschrift zum 15.", vertragsbeginn: "2020-01-09" }, "zahlart")).toEqual({
      einzugstag: null,
      einzugsquelle: "abweichend"
    });
    expect(einzugAus({ zahlart: "", vertragsbeginn: "2020-01-09" }, "zahlart")).toEqual({
      einzugstag: 9,
      einzugsquelle: "vertragsbeginn"
    });
  });
});

describe("tagImMonat", () => {
  it.each([
    [7, 7],
    ["07", 7],
    ["am 1.", 1],
    ["31.01.", 31],
    ["2026-10-31T00:00:00", 31],
    [0, null],
    ["0000-00-00", null],
    ["Lastschrift", null],
    [null, null]
  ])("%j -> %j", (wert, tag) => {
    expect(tagImMonat(wert)).toBe(tag);
  });
});

describe("spartenAus", () => {
  it.each([
    ["Kickboxen, Kids", ["Kickboxen", "Kids"]],
    ["Wing Tsun", ["Wing Tsun"]],
    ['["Kids","Kickboxen","Kids"]', ["Kickboxen", "Kids"]],
    ['[{"id":"3","name":"Kickboxen"},{"bezeichnung":"Selbstverteidigung"}]', ["Kickboxen", "Selbstverteidigung"]],
    ['{"3":"Kickboxen","4":"Kids"}', ["Kickboxen", "Kids"]],
    ['{"Kickboxen":1,"Kids":0,"Escrima":"1"}', ["Escrima", "Kickboxen"]],
    ["", []],
    [null, []],
    ["[]", []]
  ])("liest %j", (eingabe, erwartet) => {
    expect(spartenAus(eingabe)).toEqual(erwartet);
  });

  it("laesst unlesbare Eintraege aus statt zu raten", () => {
    expect(spartenAus('[{"id":"3"},"Kids",[1]]')).toEqual(["Kids"]);
  });
});

describe("erstelleBeitragsUebersicht", () => {
  const quellen = [
    mitglied("10", { beitrag: "49,90", zahlungsperiode: "monatlich", kundenart: "Mitglied", vname: "Anna", name: "Zeta" }),
    mitglied("11", { beitrag: "120,00", zahlungsperiode: "vierteljährlich", kundenart: "Mitglied", vname: "Bert", name: "Alpha", jahresgebuehr: "30,00" }),
    mitglied("12", { beitrag: "", zahlungsperiode: "", kundenart: "Trainer" }),
    mitglied("13", { beitrag: "39,00", zahlungsperiode: "monatlich", kundenart: "Stillgelegt" }),
    mitglied("14", null),
    mitglied("15", { beitrag: "unklar", zahlungsperiode: "monatlich", kundenart: "Mitglied" })
  ];

  it("summiert nur nicht stillgelegte Mitglieder und nennt jeden Ausschluss", () => {
    const uebersicht = erstelleBeitragsUebersicht(quellen, optionen);
    const z = uebersicht.zusammenfassung;

    // Standard: beitrag ist bereits der Monatsbetrag.
    expect(z.monatssummeCent).toBe(4990 + 12000 + 0);
    expect(z.jahresgebuehrSummeCent).toBe(3000);
    expect(z).toMatchObject({
      mitgliederGesamt: 6,
      eingerechnet: 3,
      mitBeitrag: 2,
      ohneBeitrag: 1,
      stillgelegt: 1,
      stammdatenFehlen: 1,
      nichtBerechenbar: 1,
      vollstaendig: false
    });
    expect(uebersicht.positionen.map((position) => position.nachname)).toEqual([
      "Alpha",
      "Nachname12",
      "Zeta"
    ]);
    expect(
      uebersicht.nichtEingerechnet.map((eintrag) => [eintrag.matoolId, eintrag.grund])
    ).toEqual([
      ["15", "beitrag_unlesbar"],
      ["14", "stammdaten_fehlen"],
      ["13", "stillgelegt"]
    ]);
  });

  it("rechnet Periodenbetraege auf Monate um, wenn so eingestellt", () => {
    const uebersicht = erstelleBeitragsUebersicht(quellen, {
      ...optionen,
      regeln: { ...DEFAULT_BEITRAGS_REGELN, betragsBezug: "zahlungsperiode" }
    });
    expect(uebersicht.zusammenfassung.monatssummeCent).toBe(4990 + 4000);
    expect(
      uebersicht.positionen.find((position) => position.matoolId === "11")
    ).toMatchObject({ beitragCent: 12000, monatsbeitragCent: 4000 });
  });

  it("markiert unbekannte Zahlungsperioden statt zu raten", () => {
    const uebersicht = erstelleBeitragsUebersicht(
      [mitglied("20", { beitrag: "50", zahlungsperiode: "woechentlich" })],
      { ...optionen, regeln: { ...DEFAULT_BEITRAGS_REGELN, betragsBezug: "zahlungsperiode" } }
    );
    expect(uebersicht.zusammenfassung).toMatchObject({
      monatssummeCent: 0,
      nichtBerechenbar: 1,
      vollstaendig: false
    });
    expect(uebersicht.nichtEingerechnet[0]).toMatchObject({
      grund: "zahlungsperiode_unbekannt",
      detail: "woechentlich"
    });
  });

  it("ist vollstaendig, wenn alle aktiven Mitglieder berechnet sind", () => {
    const uebersicht = erstelleBeitragsUebersicht(
      [
        mitglied("30", { beitrag: "10", kundenart: "Mitglied" }),
        mitglied("31", { beitrag: "20", kundenart: "Stillgelegt" })
      ],
      optionen
    );
    expect(uebersicht.zusammenfassung).toMatchObject({
      monatssummeCent: 1000,
      vollstaendig: true,
      datenstandAeltester: "2026-09-22T08:00:00.000Z"
    });
  });

  it("fuehrt Schule, Sparten und Vertragsdaten je Mitglied", () => {
    const uebersicht = erstelleBeitragsUebersicht(
      [
        mitglied("60", {
          beitrag: "45",
          kundenart: "Mitglied",
          schule: "1474",
          spartenliste: '["Kids","Kickboxen"]',
          vertragsbeginn: "2026-01-01",
          vertragsende: ""
        }),
        mitglied("61", { beitrag: "30,00", kundenart: "Stillgelegt", schule: "273" })
      ],
      { ...optionen, exMitglieder: 12 }
    );
    expect(uebersicht.positionen[0]).toMatchObject({
      schule: "Stephanskirchen",
      sparten: ["Kickboxen", "Kids"],
      vertragsbeginn: "2026-01-01",
      vertragsende: ""
    });
    // Der ruhende Beitrag bleibt sichtbar, zaehlt aber nicht zur Summe.
    expect(uebersicht.nichtEingerechnet[0]).toMatchObject({
      grund: "stillgelegt",
      schule: "Rosenheim",
      sparten: [],
      beitragCent: 3000
    });
    expect(uebersicht.zusammenfassung).toMatchObject({
      monatssummeCent: 4500,
      exMitglieder: 12
    });
    expect(erstelleBeitragsUebersicht([], optionen).zusammenfassung.exMitglieder).toBeNull();
  });

  it("summiert je Einzugstag und kennt unklare Einzugstage", () => {
    const uebersicht = erstelleBeitragsUebersicht(
      [
        mitglied("80", { beitrag: "50", kundenart: "Mitglied", vertragsbeginn: "2025-03-01" }),
        mitglied("81", { beitrag: "40", kundenart: "Mitglied", vertragsbeginn: "2025-03-15" }),
        mitglied("82", { beitrag: "35", kundenart: "Mitglied", vertragsbeginn: "2018-06-07" }),
        mitglied("83", { beitrag: "25", kundenart: "Mitglied", vertragsbeginn: "2025-03-01", abweichenderEinzug: "7" }),
        mitglied("84", { beitrag: "30", kundenart: "Mitglied", abweichenderEinzug: "ja" }),
        mitglied("85", { beitrag: "", kundenart: "Trainer", vertragsbeginn: "2025-01-15" }),
        mitglied("86", null)
      ],
      optionen
    );
    expect(uebersicht.zusammenfassung).toMatchObject({
      einzugNachTag: [
        { tag: 1, cent: 5000, zahler: 1 },
        { tag: 7, cent: 6000, zahler: 2 },
        { tag: 15, cent: 4000, zahler: 1 }
      ],
      einzugUnklar: { cent: 3000, zahler: 1 },
      monatssummeCent: 18000
    });
    expect(uebersicht.nichtEingerechnet[0]).toMatchObject({ matoolId: "86", einzugstag: null, einzugsquelle: "" });
    expect(uebersicht.positionen.find((position) => position.matoolId === "83")).toMatchObject({
      einzugstag: 7,
      einzugsquelle: "abweichend"
    });
  });

  it("gilt ohne gelesene Mitgliederliste nie als vollstaendig", () => {
    expect(erstelleBeitragsUebersicht([], optionen).zusammenfassung).toMatchObject({
      monatssummeCent: 0,
      vollstaendig: false
    });
  });
});

describe("XML", () => {
  it("erzeugt eine gueltige, maskierte Datei", () => {
    const uebersicht = erstelleBeitragsUebersicht(
      [
        mitglied("40", { beitrag: "25,50", vname: "A&B <Test>", name: "O'Neil \"X\"", kundenart: "Mitglied" }),
        mitglied("41", { beitrag: "10", kundenart: "stillgelegt" })
      ],
      optionen
    );
    const xml = beitragsUebersichtAlsXml(uebersicht);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<beitragsuebersicht version="1"')).toBe(true);
    expect(xml).toContain("<monatssumme>25.50</monatssumme>");
    expect(xml).toContain("<vorname>A&amp;B &lt;Test&gt;</vorname>");
    expect(xml).toContain("<nachname>O&apos;Neil &quot;X&quot;</nachname>");
    expect(xml).toContain('<mitglied matool_id="41" mitgliedsnummer="M-41" grund="stillgelegt">');
    expect(xml).toContain('<mitglieder anzahl="1">');
    expect(xml).toContain('<nicht_eingerechnet anzahl="1">');
    expect(xml.endsWith("</beitragsuebersicht>\n")).toBe(true);
  });

  it("entfernt Zeichen, die XML nicht erlaubt", () => {
    expect(xmlText(`a${String.fromCharCode(0)}b${String.fromCharCode(0x1b)}c\td`)).toBe("abc\td");
    expect(xmlText(`x${String.fromCharCode(0xd800)}y`)).toBe("xy");
    expect(xmlText("Ärger 😀")).toBe("Ärger 😀");
  });
});

describe("Formatierung", () => {
  it("formatiert Cent fuer Maschinen und Menschen", () => {
    expect(centAlsDezimal(123456)).toBe("1234.56");
    expect(centAlsDezimal(5)).toBe("0.05");
    expect(centAlsDezimal(-1050)).toBe("-10.50");
    expect(centAlsEuroText(123456).replace(/\s/gu, " ")).toBe("1.234,56 €");
  });
});

describe("zaehleFeldwerte", () => {
  it("zaehlt Werte je Feld, haeufigste zuerst", () => {
    const verteilung = zaehleFeldwerte(
      [
        mitglied("50", { kundenart: "Mitglied" }),
        mitglied("51", { kundenart: "Mitglied" }),
        mitglied("52", { kundenart: "Stillgelegt" }),
        mitglied("53", null)
      ],
      ["kundenart"]
    );
    expect(verteilung).toEqual([
      {
        feld: "kundenart",
        werte: [
          { anzahl: 2, wert: "Mitglied" },
          { anzahl: 1, wert: "(leer)" },
          { anzahl: 1, wert: "Stillgelegt" }
        ]
      }
    ]);
  });

  it("zaehlt jede Sparte eines Mitglieds einzeln", () => {
    const verteilung = zaehleFeldwerte(
      [
        mitglied("70", { spartenliste: "Kids, Kickboxen" }),
        mitglied("71", { spartenliste: "Kickboxen" }),
        mitglied("72", { spartenliste: "" })
      ],
      ["sparten"]
    );
    expect(verteilung[0]?.werte).toEqual([
      { anzahl: 2, wert: "Kickboxen" },
      { anzahl: 1, wert: "(leer)" },
      { anzahl: 1, wert: "Kids" }
    ]);
  });
});
