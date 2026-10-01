# Zap: Erinnerung vor dem 1. Probetraining

Ziel: Am letzten offenen Tag vor dem ersten Probetraining bekommt eine (wählbare)
E-Mail-Adresse **genau eine** gestaltete Mail mit allen Infos zum
Interessenten, damit jemand anrufen kann.

Voraussetzung: Zapier-App **1.4.0** ist freigeschaltet und der Zap darauf
migriert. Erst dann gibt es das Feld „Probetraining 1 - Erinnerung am“.

## Wann kommt die Mail?

Um 10:00 Uhr am letzten Tag **vor** dem Probetraining, an dem die Schule
erreichbar ist. Erreichbar heißt: Montag bis Freitag, kein Feiertag in
Bayern (Standort Rosenheim, also inkl. Mariä Himmelfahrt) und keine
Schließzeit. Geschlossen ist die vorletzte Woche der bayerischen
Sommerferien und die kompletten Weihnachtsferien.

| Probetraining | Mail |
|---|---|
| Dienstag, 06.10.2026 | Montag, 05.10.2026 |
| Montag, 05.10.2026 | Freitag, 02.10.2026 |
| Dienstag, 30.03.2027 (nach Ostern) | Donnerstag, 25.03.2027 |
| Montag, 11.01.2027 (nach den Weihnachtsferien) | Mittwoch, 23.12.2026 |
| Montag, 06.09.2027 (nach der Schließwoche) | Freitag, 27.08.2027 |

Wird ein Termin so spät eingetragen, dass dieser Tag schon vorbei ist, kommt
die Mail sofort, falls heute offen ist, sonst am nächsten offenen Tag um
10:00 Uhr (notfalls am Morgen des Probetrainings). In Schließzeiten und am
Wochenende geht keine Mail raus, solange bis zum Termin noch ein offener Tag
kommt.

Die Zapier-App rechnet das aus und liefert es fertig im Feld
„Probetraining 1 - Erinnerung am“, z. B. `2026-10-02T10:00:00+02:00`. Ohne
Termin oder bei einem Termin in der Vergangenheit bleibt das Feld leer.
Schließzeiten stehen in
`zapier-app/src/triggers/probetraining-erinnerung.ts` (`SCHLIESSZEITEN`) und
reichen bis Sommer 2030. Ändert sich eine Schließzeit, muss sie dort angepasst
und eine neue App-Version veröffentlicht werden.

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
| 4 | **Filter** – Only continue if | (a) *Probetraining 1 - Erinnerung am* · (Text) Exists · (b) Value aus **Schritt 2** (nicht 3!) · (Text) Does not exactly match · gleicher Text wie Value in Schritt 3 |
| 5 | **Delay by Zapier** – Delay Until | Date/Time: *Probetraining 1 - Erinnerung am* · Dates in the past: **Always continue** |
| 6 | **Storage by Zapier** – Get Value | Key: wie Schritt 2 · Successful if no search results are found: **False** (fehlt der Wert, ist etwas faul → anhalten) |
| 7 | **Filter** | Value aus Schritt 6 · (Text) Exactly matches · gleicher Text wie Value in Schritt 3 (sonst wurde der Termin inzwischen verschoben/gelöscht) |
| 8 | **Formatter** – Utilities → Lookup Table *(optional, für die variable Adresse)* | Lookup Key: *Probetraining 1 - Klassenname* · Tabelle z. B. `Tiger-Kids` → `kinder@…`, `Erwachsene` → `trainer@…` · Fallback: `info@…` |
| 9 | **Email by Zapier** – Send Outbound Email | To: Ergebnis aus Schritt 8 (oder feste Adresse) · Reply To: eigene Adresse · Force Linebreaks: **No** · Subject: `Probetraining am ` + *Probetraining 1 - Datum* + `: ` + *Vorname* + ` ` + *Nachname* + ` – bitte anrufen` · Body: Inhalt von `probetraining-1-erinnerung.html` |

Bis Zapier-App 1.3.0 hießen die Felder roh:
*Probetraining 1 - Datum* = „Einfuehrung“, *- Uhrzeit* = „Einfuehrung Zeit“,
*- Klassenname* = „Einfuehrung Klasse Name“, *MATOOL-Interessenten-ID* =
„Matool Id“. Achtung: „Probetraining“ ist dort Probetraining **2**.

## Umbau eines Zaps mit der alten Montag-Freitag-Tabelle

1. Zap auf App-Version 1.4.0 migrieren, dann Schritt 1 neu testen, damit
   „Probetraining 1 - Erinnerung am“ unter „Insert Data“ erscheint.
2. Die alten Schritte 5 bis 9 löschen (Formatter Wochentag, Lookup Table
   Vorlauf, Add/Subtract Time, Format ISO-Datum, Filter „Termin in der
   Zukunft“).
3. Im Filter (Schritt 4) die Bedingungen „Probetraining 1 - Datum exists“
   und „does not contain 0000“ durch *Probetraining 1 - Erinnerung am* ·
   Exists ersetzen.
4. Im Delay Until als Date/Time nur noch *Probetraining 1 - Erinnerung am*
   einsetzen.
5. In den beiden Storage-Schritten danach prüfen, dass sie noch auf die
   richtigen Schritte verweisen (Zapier nummeriert neu).

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
- Der Erinnerungszeitpunkt wird beim Eintreffen des Datensatzes berechnet.
  Eine nachträglich geänderte Schließzeit wirkt nur auf neue Läufe.
- Die Mail enthält Personendaten: nur an interne Adressen schicken.
