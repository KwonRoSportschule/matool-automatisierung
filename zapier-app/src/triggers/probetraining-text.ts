/**
 * Fertige Textfelder für Probetraining 1 und 2, z. B.
 * "24.09.2026, 17:00 Uhr, Tiger-Kids". So lässt sich der Termin in Zapier
 * mit einem Feld statt dreien einfügen. Die Einzelfelder bleiben erhalten.
 */
export function probetrainingTexte(
  record: Readonly<Record<string, unknown>>
): { probetraining_1: string; probetraining_2: string } {
  return {
    probetraining_1: probetrainingText(
      record.einfuehrung,
      record.einfuehrung_zeit,
      record.einfuehrung_klasse_name
    ),
    probetraining_2: probetrainingText(
      record.probetraining,
      record.probetraining_zeit,
      record.probetraining_klasse_name
    )
  };
}

/**
 * MATOOL liefert Datum und Uhrzeit meist schon deutsch (25.09.2026,
 * 17:00 Uhr), je nach Maske auch roh (2026-09-24, 17:00:00). 0000-00-00,
 * 00:00:00 und 00:00 Uhr heißen "nicht gesetzt". Ohne Datum gibt es keinen
 * Termin, dann bleibt der Text leer.
 */
export function probetrainingText(
  datum: unknown,
  zeit: unknown,
  klasse: unknown
): string {
  const tag = readableDate(text(datum));
  if (tag === "") {
    return "";
  }
  return [tag, readableTime(text(zeit)), text(klasse)]
    .filter((part) => part !== "")
    .join(", ");
}

function text(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const trimmed = String(value).trim();
  // Nur Nullen und Trennzeichen (0, 0000-00-00, 00:00:00) oder MATOOLs
  // Platzhalter "---" bedeuten: kein Wert.
  return /^[0\s.:-]*$/u.test(trimmed) ? "" : trimmed;
}

function readableDate(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/u.exec(value);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : value;
}

function readableTime(value: string): string {
  const time = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*Uhr)?$/iu.exec(value);
  if (!time) {
    return value;
  }
  const [, hour = "", minute = ""] = time;
  return Number(hour) === 0 && minute === "00"
    ? ""
    : `${hour.padStart(2, "0")}:${minute} Uhr`;
}
