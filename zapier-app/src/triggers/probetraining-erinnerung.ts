/**
 * Versandzeitpunkt der Erinnerung vor Probetraining 1, z. B.
 * "2026-10-02T10:00:00+02:00": 10:00 Uhr am letzten Tag vor dem Termin, an
 * dem die Schule erreichbar ist. Erreichbar heißt Montag bis Freitag, kein
 * Feiertag in Rosenheim und keine Schließzeit. Ein Probetraining am Montag
 * wird so am Freitag erinnert, eines nach den Weihnachtsferien vor den Ferien.
 *
 * Ist dieser Tag schon vorbei (Termin kurzfristig oder während einer
 * Schließzeit eingetragen), gilt der nächste erreichbare Moment ab jetzt,
 * notfalls der Morgen des Probetrainings. Ohne Datum oder bei einem Termin in
 * der Vergangenheit bleibt das Feld leer.
 */
export function probetrainingErinnerung(datum: unknown, jetzt: Date): string {
  const termin = kalendertag(datum);
  if (termin === undefined) {
    return "";
  }
  const jetztMs = jetzt.getTime();
  const heute = berlinTag(jetztMs);
  if (termin < heute) {
    return "";
  }

  for (let tag = termin - 1; tag >= termin - 31; tag -= 1) {
    if (istErreichbar(tag)) {
      if (um10(tag) > jetztMs) {
        return berlinIso(um10(tag));
      }
      break;
    }
  }
  for (let tag = heute; tag <= termin; tag += 1) {
    if (istErreichbar(tag)) {
      return berlinIso(Math.max(jetztMs, um10(tag)));
    }
  }
  return berlinIso(jetztMs);
}

/**
 * Tage, an denen die Schule geschlossen ist: die vorletzte Woche der
 * bayerischen Sommerferien und die kompletten Weihnachtsferien. Ferientermine
 * laut Kultusministerium (openholidaysapi.org); die Sommerferien enden in
 * Bayern an einem Montag, die vorletzte Woche liegt 14 bis 8 Tage davor.
 * Die Liste reicht bis Sommer 2030.
 */
export const SCHLIESSZEITEN: readonly (readonly [string, string])[] = [
  ["2026-12-24", "2027-01-08"], // Weihnachtsferien 2026/27
  ["2027-08-30", "2027-09-05"], // Sommerferien 02.08.–13.09.2027
  ["2027-12-24", "2028-01-07"], // Weihnachtsferien 2027/28
  ["2028-08-28", "2028-09-03"], // Sommerferien 31.07.–11.09.2028
  ["2028-12-23", "2029-01-05"], // Weihnachtsferien 2028/29
  ["2029-08-27", "2029-09-02"], // Sommerferien 30.07.–10.09.2029
  ["2029-12-24", "2030-01-04"], // Weihnachtsferien 2029/30
  ["2030-08-26", "2030-09-01"] // Sommerferien 29.07.–09.09.2030
];

const TAG_MS = 86_400_000;

const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

const schliesstage = SCHLIESSZEITEN.map(
  ([von, bis]) => [isoTag(von), isoTag(bis)] as const
);

/** Kalendertag als fortlaufende Tagesnummer (Tage seit 1970-01-01). */
function kalendertag(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  const deutsch = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(text);
  const roh = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/u.exec(text);
  const [jahr, monat, tag] = deutsch
    ? [deutsch[3], deutsch[2], deutsch[1]]
    : roh
      ? [roh[1], roh[2], roh[3]]
      : [];
  if (jahr === undefined || monat === undefined || tag === undefined) {
    return undefined;
  }
  const datum = new Date(Date.UTC(Number(jahr), Number(monat) - 1, Number(tag)));
  // Weist 0000-00-00, 00.00.0000 und unmögliche Tage wie 31.02. ab.
  return datum.getUTCFullYear() === Number(jahr) &&
    datum.getUTCMonth() === Number(monat) - 1 &&
    datum.getUTCDate() === Number(tag)
    ? datum.getTime() / TAG_MS
    : undefined;
}

function isoTag(value: string): number {
  const tag = kalendertag(value);
  if (tag === undefined) {
    throw new RangeError(`Ungültiges Datum in SCHLIESSZEITEN: ${value}`);
  }
  return tag;
}

function istErreichbar(tag: number): boolean {
  const wochentag = new Date(tag * TAG_MS).getUTCDay();
  return (
    wochentag !== 0 &&
    wochentag !== 6 &&
    !istFeiertag(tag) &&
    !schliesstage.some(([von, bis]) => tag >= von && tag <= bis)
  );
}

/** Gesetzliche Feiertage in Bayern am Standort Rosenheim. */
function istFeiertag(tag: number): boolean {
  const datum = new Date(tag * TAG_MS);
  const jahr = datum.getUTCFullYear();
  const monatTag = datum.toISOString().slice(5, 10);
  if (
    ["01-01", "01-06", "05-01", "08-15", "10-03", "11-01", "12-25", "12-26"]
      .includes(monatTag)
  ) {
    return true;
  }
  // Karfreitag, Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam
  return [-2, 1, 39, 50, 60].includes(tag - ostersonntag(jahr));
}

/** Gaußsche Osterformel (gregorianisch, Anonymer Algorithmus). */
function ostersonntag(jahr: number): number {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(jahr, monat - 1, tag) / TAG_MS;
}

/** Abstand Berliner Ortszeit zu UTC in Millisekunden. */
function berlinVersatz(ms: number): number {
  const teile = Object.fromEntries(
    berlinFormat
      .formatToParts(new Date(ms))
      .map((teil) => [teil.type, Number(teil.value)])
  );
  const ortszeit = Date.UTC(
    teile.year ?? 0,
    (teile.month ?? 1) - 1,
    teile.day ?? 1,
    teile.hour ?? 0,
    teile.minute ?? 0,
    teile.second ?? 0
  );
  return ortszeit - Math.floor(ms / 1000) * 1000;
}

function berlinTag(ms: number): number {
  return Math.floor((ms + berlinVersatz(ms)) / TAG_MS);
}

/** 10:00 Uhr Berliner Zeit am Tag; Zeitumstellungen liegen nachts. */
function um10(tag: number): number {
  const ortszeit = tag * TAG_MS + 10 * 3_600_000;
  return ortszeit - berlinVersatz(ortszeit);
}

function berlinIso(ms: number): string {
  const sekunde = Math.floor(ms / 1000) * 1000;
  const versatz = berlinVersatz(sekunde);
  const stunden = String(Math.floor(Math.abs(versatz) / 3_600_000)).padStart(2, "0");
  const minuten = String((Math.abs(versatz) / 60_000) % 60).padStart(2, "0");
  return `${new Date(sekunde + versatz).toISOString().slice(0, 19)}${
    versatz < 0 ? "-" : "+"
  }${stunden}:${minuten}`;
}
