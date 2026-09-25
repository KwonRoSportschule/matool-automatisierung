import {
  defineCreate,
  defineInputFields,
  type CreatePerform,
  type ZObject
} from "zapier-platform-core";

import { API_PATHS, middlewareApiUrl } from "../constants.js";

export const inputFields = defineInputFields([
  {
    key: "stichtag",
    label: "Stichtag",
    type: "string",
    required: false,
    helpText:
      "Datum der Übersicht als JJJJ-MM-TT, z. B. 2026-10-01. Leer lassen für heute (Europe/Berlin). Der Stichtag erscheint in Datei und Dateiname.",
    placeholder: "2026-10-01"
  },
  {
    key: "bei_unvollstaendigen_daten",
    label: "Bei unvollständigen Daten",
    type: "string",
    required: true,
    default: "abbrechen",
    choices: {
      abbrechen: "Abbrechen und als Fehler melden (empfohlen)",
      trotzdem: "Trotzdem erstellen"
    },
    helpText:
      "Unvollständig heißt: Für mindestens ein nicht stillgelegtes Mitglied fehlen Stammdaten oder der Beitrag ist nicht lesbar. Abbrechen verhindert, dass eine zu niedrige Summe verschickt wird."
  }
]);

interface BeitragsAntwort {
  dateiname?: unknown;
  id?: unknown;
  mitglieder?: unknown;
  monatssumme?: unknown;
  nicht_eingerechnet?: unknown;
  stichtag?: unknown;
  vollstaendig?: unknown;
  xml?: unknown;
  [feld: string]: unknown;
}

function ungueltigeAntwort(z: ZObject): never {
  throw new z.errors.Error(
    "Die Middleware hat keine gültige Beitragsübersicht geliefert.",
    "invalid_beitraege_response"
  );
}

function stichtag(z: ZObject, value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new z.errors.Error(
      "Der Stichtag muss als JJJJ-MM-TT angegeben werden.",
      "invalid_beitraege_stichtag"
    );
  }
  return text;
}

function anzahl(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

export const perform = (async (z, bundle) => {
  const tag = stichtag(z, bundle.inputData.stichtag);
  const query = tag ? `?${new URLSearchParams({ stichtag: tag }).toString()}` : "";
  const response = await z.request<BeitragsAntwort>({
    method: "GET",
    url: `${middlewareApiUrl(API_PATHS.beitraege)}${query}`
  });
  response.throwForStatus();

  const data = response.data;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.id !== "string" ||
    typeof data.stichtag !== "string" ||
    typeof data.monatssumme !== "string" ||
    typeof data.vollstaendig !== "boolean" ||
    typeof data.xml !== "string" ||
    typeof data.dateiname !== "string" ||
    !/^beitragsuebersicht_\d{4}-\d{2}-\d{2}\.xml$/u.test(data.dateiname) ||
    !Array.isArray(data.mitglieder) ||
    !Array.isArray(data.nicht_eingerechnet)
  ) {
    ungueltigeAntwort(z);
  }

  if (!data.vollstaendig && bundle.inputData.bei_unvollstaendigen_daten !== "trotzdem") {
    throw new z.errors.Error(
      `Beitragsübersicht unvollständig: ${anzahl(data.anzahl_stammdaten_fehlen)} Mitglieder ohne Stammdaten, ${anzahl(data.anzahl_nicht_berechenbar)} nicht berechenbar. Nach dem nächsten MATOOL-Abruf erneut ausführen oder im Hub unter „Beiträge“ prüfen.`,
      "beitraege_unvollstaendig"
    );
  }

  const xmlDatei = await z.stashFile(
    Buffer.from(data.xml, "utf8"),
    Buffer.byteLength(data.xml, "utf8"),
    data.dateiname,
    "application/xml"
  );

  // Die XML steckt in der Datei; als Textfeld wuerde sie jede Zap-Ansicht
  // sprengen.
  const { xml: _xml, ...felder } = data;
  return {
    ...felder,
    xml_datei: xmlDatei
  };
}) satisfies CreatePerform<typeof inputFields>;

export const sample = {
  schema_version: 1,
  id: "beitraege:2026-10-01",
  stichtag: "2026-10-01",
  erstellt_am: "2026-10-01T05:00:00.000Z",
  waehrung: "EUR",
  betragsbezug: "monat",
  vollstaendig: true,
  monatssumme: "99.40",
  monatssumme_cent: 9940,
  monatssumme_text: "99,40 €",
  jahresgebuehr_summe: "0.00",
  anzahl_mitglieder_gesamt: 3,
  anzahl_eingerechnet: 2,
  anzahl_mit_beitrag: 2,
  anzahl_ohne_beitrag: 0,
  anzahl_stillgelegt: 1,
  anzahl_stammdaten_fehlen: 0,
  anzahl_nicht_berechenbar: 0,
  datenstand_aeltester: "2026-09-30T08:00:00.000Z",
  datenstand_neuester: "2026-09-30T16:00:00.000Z",
  dateiname: "beitragsuebersicht_2026-10-01.xml",
  xml_datei: "https://zapier.example.invalid/beitragsuebersicht_2026-10-01.xml",
  mitglieder: [
    {
      matool_id: "90001",
      mitgliedsnummer: "M-1",
      vorname: "Beispiel",
      nachname: "Mitglied",
      vertrag: "Beispielvertrag",
      kundenart: "Mitglied",
      zahlungsperiode: "monatlich",
      zahlart: "Lastschrift",
      beitrag: "59.90",
      monatsbeitrag: "59.90"
    },
    {
      matool_id: "90002",
      mitgliedsnummer: "M-2",
      vorname: "Zweites",
      nachname: "Beispiel",
      vertrag: "Beispielvertrag Kinder",
      kundenart: "Mitglied",
      zahlungsperiode: "monatlich",
      zahlart: "Lastschrift",
      beitrag: "39.50",
      monatsbeitrag: "39.50"
    }
  ],
  nicht_eingerechnet: [
    {
      matool_id: "90003",
      mitgliedsnummer: "M-3",
      vorname: "Ruhendes",
      nachname: "Beispiel",
      vertrag: "Beispielvertrag",
      kundenart: "Stillgelegt",
      grund: "stillgelegt",
      detail: "kundenart: Stillgelegt"
    }
  ]
};

export default defineCreate({
  key: "beitragsuebersicht",
  noun: "Beitragsübersicht",
  display: {
    label: "Beitragsübersicht Erstellen",
    description:
      "Sums the monthly contributions of all members that are not suspended and returns the totals plus an XML file with one entry per member. Read-only; it never changes MATOOL data."
  },
  operation: {
    inputFields,
    perform,
    sample,
    outputFields: [
      { key: "monatssumme", label: "Monatssumme (EUR, Punkt als Dezimaltrenner)" },
      { key: "monatssumme_text", label: "Monatssumme formatiert" },
      { key: "vollstaendig", label: "Vollständig", type: "boolean" },
      { key: "anzahl_eingerechnet", label: "Anzahl eingerechnete Mitglieder", type: "integer" },
      { key: "anzahl_stillgelegt", label: "Anzahl stillgelegte Mitglieder", type: "integer" },
      { key: "anzahl_stammdaten_fehlen", label: "Anzahl ohne Stammdaten", type: "integer" },
      { key: "stichtag", label: "Stichtag" },
      { key: "dateiname", label: "Dateiname" },
      { key: "xml_datei", label: "XML-Datei", type: "file" }
    ]
  }
});
