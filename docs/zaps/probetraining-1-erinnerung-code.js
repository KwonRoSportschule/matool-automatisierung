// Code by Zapier (Run JavaScript): Versandzeitpunkt der Erinnerung vor
// Probetraining 1. Input Data: datum = "Probetraining 1 - Datum".
//
// Regel: 10:00 Uhr am letzten Tag VOR dem Termin, an dem die Schule
// erreichbar ist: Montag bis Freitag, kein Feiertag in Bayern (Rosenheim),
// keine Schließzeit. Ist dieser Tag schon vorbei, gilt der nächste offene
// Moment ab jetzt (notfalls der Morgen des Probetrainings). Ohne Datum oder
// bei einem Termin in der Vergangenheit bleibt "erinnerung" leer.

// Schließzeiten, jeweils von/bis einschließlich: vorletzte Woche der
// bayerischen Sommerferien und die Weihnachtsferien. Neue Jahre hier
// ergänzen, sobald das Kultusministerium die Ferien veröffentlicht.
const SCHLIESSZEITEN = [
  ["2026-12-24", "2027-01-08"], // Weihnachtsferien 2026/27
  ["2027-08-30", "2027-09-05"], // vorletzte Woche Sommerferien 2027
  ["2027-12-24", "2028-01-07"], // Weihnachtsferien 2027/28
  ["2028-08-28", "2028-09-03"], // vorletzte Woche Sommerferien 2028
  ["2028-12-23", "2029-01-05"], // Weihnachtsferien 2028/29
  ["2029-08-27", "2029-09-02"], // vorletzte Woche Sommerferien 2029
  ["2029-12-24", "2030-01-04"], // Weihnachtsferien 2029/30
  ["2030-08-26", "2030-09-01"] // vorletzte Woche Sommerferien 2030
];
const UHRZEIT = 10;

const TAG = 86400000;
const STUNDE = 3600000;
const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

// "25.09.2026" oder "2026-09-25" -> Tagesnummer, sonst null
function tagNr(text) {
  const t = String(text || "").trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  let j, mo, d;
  if (m) {
    d = +m[1]; mo = +m[2]; j = +m[3];
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) {
    j = +m[1]; mo = +m[2]; d = +m[3];
  } else {
    return null;
  }
  const x = new Date(Date.UTC(j, mo - 1, d));
  if (x.getUTCFullYear() !== j || x.getUTCMonth() !== mo - 1 || x.getUTCDate() !== d) {
    return null;
  }
  return x.getTime() / TAG;
}

function ostersonntag(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return Date.UTC(jahr, Math.floor(n / 31) - 1, (n % 31) + 1) / TAG;
}

function istFeiertag(tag) {
  const datum = new Date(tag * TAG);
  const mmtt = datum.toISOString().slice(5, 10);
  // Neujahr, Hl. Drei Könige, 1. Mai, Mariä Himmelfahrt, Tag der Deutschen
  // Einheit, Allerheiligen, 1. und 2. Weihnachtstag
  if (["01-01", "01-06", "05-01", "08-15", "10-03", "11-01", "12-25", "12-26"].includes(mmtt)) {
    return true;
  }
  // Karfreitag, Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam
  return [-2, 1, 39, 50, 60].includes(tag - ostersonntag(datum.getUTCFullYear()));
}

function istGeschlossen(tag) {
  return SCHLIESSZEITEN.some(([von, bis]) => tag >= tagNr(von) && tag <= tagNr(bis));
}

function istOffen(tag) {
  const wt = new Date(tag * TAG).getUTCDay();
  return wt !== 0 && wt !== 6 && !istFeiertag(tag) && !istGeschlossen(tag);
}

// Berliner Zeit: Sommerzeit von letzten Sonntag im März bis letzten Sonntag
// im Oktober, jeweils ab 01:00 UTC
function letzterSonntag(jahr, monat) {
  const ende = Date.UTC(jahr, monat, 0);
  return ende - new Date(ende).getUTCDay() * TAG;
}
function versatz(ms) {
  const j = new Date(ms).getUTCFullYear();
  const sommer = ms >= letzterSonntag(j, 3) + STUNDE && ms < letzterSonntag(j, 10) + STUNDE;
  return sommer ? 2 * STUNDE : STUNDE;
}
function berlinTag(ms) {
  return Math.floor((ms + versatz(ms)) / TAG);
}
function versandAm(tag) {
  const lokal = tag * TAG + UHRZEIT * STUNDE;
  return lokal - versatz(lokal);
}

function versandzeit(termin, jetzt) {
  for (let tag = termin - 1; tag >= termin - 45; tag--) {
    if (istOffen(tag)) {
      if (versandAm(tag) > jetzt) return versandAm(tag);
      break;
    }
  }
  for (let tag = berlinTag(jetzt); tag <= termin; tag++) {
    if (istOffen(tag)) return Math.max(jetzt, versandAm(tag));
  }
  return jetzt;
}

const termin = tagNr(inputData.datum);
const jetzt = Date.now();
let erinnerung = "";
let erinnerungText = "";
if (termin !== null && termin >= berlinTag(jetzt)) {
  const ms = Math.floor(versandzeit(termin, jetzt) / 1000) * 1000;
  const v = versatz(ms);
  const lokal = new Date(ms + v);
  const iso = lokal.toISOString();
  erinnerung = iso.slice(0, 19) + (v === 2 * STUNDE ? "+02:00" : "+01:00");
  erinnerungText = WOCHENTAGE[lokal.getUTCDay()] + ", " + iso.slice(8, 10) + "." +
    iso.slice(5, 7) + "." + iso.slice(0, 4) + ", " + iso.slice(11, 16) + " Uhr";
}

output = { erinnerung: erinnerung, erinnerung_text: erinnerungText };
