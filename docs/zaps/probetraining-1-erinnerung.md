# Zap: Erinnerung vor dem 1. Probetraining

Ziel: Am letzten offenen Tag vor dem ersten Probetraining bekommt eine (wählbare)
E-Mail-Adresse **genau eine** gestaltete Mail mit allen Infos zum
Interessenten, damit jemand anrufen kann.

Voraussetzung: Zapier-App **1.3.0** (PR #22) ist freigeschaltet. Erst dann
gibt es die Felder „Probetraining 1“, „Probetraining 1 - Datum“ usw.

## Wann kommt die Mail?

Um 10:00 Uhr am letzten Tag **vor** dem Probetraining, an dem die Schule
erreichbar ist: Montag bis Freitag, kein Feiertag in Bayern (Standort
Rosenheim, also inkl. Mariä Himmelfahrt) und keine Schließzeit. Geschlossen
ist die vorletzte Woche der bayerischen Sommerferien und die kompletten
Weihnachtsferien.

| Probetraining | Mail |
|---|---|
| Dienstag, 06.10.2026 | Montag, 05.10.2026 |
| Montag, 05.10.2026 | Freitag, 02.10.2026 |
| Dienstag, 30.03.2027 (nach Ostern) | Donnerstag, 25.03.2027 |
| Montag, 11.01.2027 (nach den Weihnachtsferien) | Mittwoch, 23.12.2026 |
| Montag, 06.09.2027 (nach der Schließwoche) | Freitag, 27.08.2027 |

Ist dieser Tag schon vorbei, weil der Termin kurzfristig oder in einer
Schließzeit eingetragen wurde, kommt die Mail sofort, falls heute offen ist,
sonst am nächsten offenen Tag um 10:00 Uhr (notfalls am Morgen des
Probetrainings).

Das rechnet ein **Code by Zapier**-Schritt (Schritt 5) mit dem Code aus
[`probetraining-1-erinnerung-code.js`](probetraining-1-erinnerung-code.js).
Feiertage berechnet er selbst, die Schließzeiten stehen oben im Code.

## Warum so viele Schritte?

Der Trigger meldet jeden neuen **und jeden geänderten** Interessenten. Ohne
Schutz gäbe es bei jeder Änderung (neue Telefonnummer, Status, Notiz) eine
weitere Mail, und ein verschobener Termin würde die alte Erinnerung trotzdem
verschicken. Storage by Zapier merkt sich deshalb pro Interessent den
aktuellen Termin:

- gleicher Termin wie gemerkt → kein zweiter Lauf,
- Termin verschoben oder gelöscht → wartende alte Läufe brechen vor dem
  Versand ab, nur der neue Termin wird erinnert.

## Schritte

| # | App / Aktion | Einstellung |
|---|---|---|
| 1 | **MATOOL Middleware** – Neuer oder geänderter MATOOL-Interessent | Nur neue Interessenten: **Nein**, Nur Änderungen: **Nein** |
| 2 | **Storage by Zapier** – Get Value | Key: `pt1-` + *MATOOL-Interessenten-ID* · Successful if no search results are found: **True** (neuer Interessent hat noch keinen Wert) · Create … if it doesn't exist: **aus** |
| 3 | **Storage by Zapier** – Set Value | Key: wie Schritt 2 · Value: `PT:` + *Probetraining 1 - Datum* + Leerzeichen + *Probetraining 1 - Uhrzeit* |
| 4 | **Filter** – Only continue if | (a) *Probetraining 1 - Datum* · (Text) Exists · (b) *Probetraining 1 - Datum* · (Text) Does not contain · `0000` · (c) Value aus **Schritt 2** (nicht 3!) · (Text) Does not exactly match · gleicher Text wie Value in Schritt 3 |
| 5 | **Code by Zapier** – Run JavaScript (Versandzeitpunkt) | Input Data: links `datum`, rechts *Probetraining 1 - Datum* · Code: alles aus `probetraining-1-erinnerung-code.js` einfügen (vorhandenen Beispielcode vorher löschen) · Test liefert z. B. `erinnerung` = `2026-10-02T10:00:00+02:00` und `erinnerung_text` = `Freitag, 02.10.2026, 10:00 Uhr` |
| 6 | **Filter** | *Erinnerung* aus Schritt 5 · (Text) Exists – leer heißt: Termin liegt in der Vergangenheit |
| 7 | **Delay by Zapier** – Delay Until | Date/Time: *Erinnerung* aus Schritt 5 · Dates in the past: **Always continue** |
| 8 | **Storage by Zapier** – Get Value | Key: wie Schritt 2 · Successful if no search results are found: **False** (fehlt der Wert, ist etwas faul → anhalten) |
| 9 | **Filter** | Value aus Schritt 8 · (Text) Exactly matches · gleicher Text wie Value in Schritt 3 (sonst wurde der Termin inzwischen verschoben/gelöscht) |
| 10 | **Formatter** – Utilities → Lookup Table *(optional, für die variable Adresse)* | Lookup Key: *Probetraining 1 - Klassenname* · Tabelle z. B. `Tiger-Kids` → `kinder@…`, `Erwachsene` → `trainer@…` · Fallback: `info@…` |
| 11 | **Email by Zapier** – Send Outbound Email | To: Ergebnis aus Schritt 10 (oder feste Adresse) · Reply To: eigene Adresse · Force Linebreaks: **No** · Subject: `Probetraining am ` + *Probetraining 1 - Datum* + `: ` + *Vorname* + ` ` + *Nachname* + ` – bitte anrufen` · Body: Inhalt von `probetraining-1-erinnerung.html` |

Code by Zapier kostet einen Task, läuft aber erst nach dem Filter in
Schritt 4, also nur einmal pro neuem oder verschobenem Termin.

Bis Zapier-App 1.3.0 freigeschaltet ist, heißen die Felder noch roh:
*Probetraining 1 - Datum* = „Einfuehrung“, *- Uhrzeit* = „Einfuehrung Zeit“,
*- Klassenname* = „Einfuehrung Klasse Name“, *MATOOL-Interessenten-ID* =
„Matool Id“. Achtung: „Probetraining“ ist dort Probetraining **2**.

## Umbau des Zaps mit der Montag-Freitag-Tabelle

Wer den Zap schon mit 14 Schritten gebaut hat:

1. Die Schritte 5 bis 8 löschen: Formatter Wochentag, Lookup Table Vorlauf,
   Add/Subtract Time und Format ISO-Datum.
2. Direkt nach dem Filter (Schritt 4) **Code by Zapier → Run JavaScript**
   einfügen und wie Schritt 5 oben einstellen. Einmal testen.
3. Im Filter danach („Termin in der Zukunft“) die alte Bedingung löschen und
   durch *Erinnerung* aus dem Code-Schritt · (Text) Exists ersetzen.
4. Im **Delay Until** bei Date/Time das alte Feld löschen und *Erinnerung*
   aus dem Code-Schritt einsetzen.
5. Storage, Filter, Lookup und E-Mail danach bleiben, wie sie sind. Zapier
   nummeriert die Schritte neu, die Verknüpfungen bleiben erhalten.

## Schließzeiten pflegen

Die Liste `SCHLIESSZEITEN` oben im Code reicht bis Sommer 2030. Sobald das
Kultusministerium neue Ferien veröffentlicht, im Zap den Code-Schritt öffnen
und je Schließzeit eine Zeile im selben Format ergänzen:

```js
  ["JJJJ-MM-TT", "JJJJ-MM-TT"], // Weihnachtsferien 2030/31
```

Von/bis zählen einschließlich. Vorletzte Sommerferienwoche: Montag bis
Sonntag, 14 bis 8 Tage vor dem letzten Ferientag (in Bayern ein Montag).
Andere Versandzeit: `UHRZEIT` im Code ändern.

## Platzhalter in der HTML-Vorlage

Die Vorlage ist für **Email by Zapier** (Send Outbound Email, Force Linebreaks:
No) gebaut und funktioniert genauso in Gmail/Outlook mit Body-Format HTML.
Jeder Platzhalter heißt wie das Feld aus Schritt 1 (Namen vor App-Version
1.3.0) und kommt einmal vor, nur `[Handy]` zweimal (Anruf-Link und
Knopftext). In Zapier jeden `[…]`-Text löschen und an seiner Stelle das
gleichnamige Feld aus Schritt 1 einfügen:

`[Vorname]` `[Name]` `[Einfuehrung]` `[Einfuehrung Zeit]`
`[Einfuehrung Klasse Name]` `[Handy]` (2×) `[Telefon]` `[Email]` `[Plz]`
`[Ort]` `[Status]` `[Kontakt]` `[Werbung Bezeichnung]` `[Datum]` `[Text]`
`[Matool Id]`

Einen Testlauf zuerst an die eigene Adresse schicken.

## Grenzen

- MATOOL wird werktags stündlich (7–18 Uhr UTC) plus einmal abends gelesen.
  Ein am Wochenende eingetragener Termin für Montag kommt erst Montag früh an;
  die Mail geht dann Montag ab 10:00 Uhr raus.
- Delay Until wartet höchstens rund einen Monat. Termine, die weiter in der
  Zukunft liegen, bitte nicht über diesen Zap erinnern lassen. Vor den
  Weihnachtsferien kann die Mail bis zu drei Wochen vor dem Termin kommen.
- Die Mail enthält Personendaten: nur an interne Adressen schicken.
