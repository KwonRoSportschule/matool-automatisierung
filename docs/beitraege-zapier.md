# Beitragsübersicht: Hub-Funktion, Klassenauswertung und Zapier-Ablauf

Stand: 28. September 2026

## Ziel

Am 1. und am 15. jedes Monats erstellt Zapier eine XML-Datei mit allen nicht
stillgelegten Mitgliedern, ihrem Monatsbeitrag und der Monatssumme aller
Beiträge.

Angezeigt und ausgewertet wird die Beitragsübersicht **nicht mehr im Hub**,
sondern in der Klassenauswertung (Check-in-/Telemetrieseite,
Repository `weekly-checkin-check-claude-matool-automatisierung`) unter
`/beitraege`: je Monat und Einzugstag (Gesamt, 1., 15., andere Tage), je Mitglied mit
Vertrag und Beitrag, Monatssumme, Mitglieder gesamt, stillgelegte und
Ex-Mitglieder, Filter nach Schule, Sparte und Vertrag.

Der Hub rechnet, Klassenauswertung und Zapier zeigen bzw. verteilen. Die
Berechnung liegt vollständig im Hub, damit beide garantiert dieselbe Zahl
zeigen und die Regeln an einer Stelle geändert werden.

```text
                        Hub (rechnet + sichert täglich)
                          |                      |
  GET /api/checkin/v1/beitraege          GET /api/zapier/v1/beitraege
   (CHECKIN_SERVICE_TOKEN)                  (ZAPIER_SERVICE_TOKEN)
                          |                      |
     Klassenauswertung /beitraege          Zapier: XML am 1./15.
     (eigenes Passwort, speichert nichts)
```

```text
Schedule by Zapier (1. und 15.)
        |
        v
MATOOL Middleware: "Beitragsübersicht erstellen"
        |   GET /api/zapier/v1/beitraege
        v
Summen + XML-Datei  ──>  E-Mail-Anhang / Google Drive / ...
```

## Was der Hub rechnet

Datenquelle ist der bereits laufende stündliche MATOOL-Abruf:

- **Mitgliederliste** (`schueler`): wer aktuell Mitglied ist. Sie wird bei
  jedem vollständigen Abruf exakt ersetzt; Ausgetretene fallen damit heraus.
- **Mitglieder-Stammdaten** (`schueler_details`): `beitrag`,
  `zahlungsperiode`, `kundenart`, `vertrag`, `vertragsbeginn`,
  `vertragsende`, `jahresgebuehr`, `jahresgebuehrdatum`, `zahlart`,
  `schule`, `spartenliste`, `abweichenderEinzug`, Name und Mitgliedsnummer. Bank-, Geburts- und Kontaktdaten werden für die
  Beitragsübersicht nicht einmal gelesen.
- **Ehemalige Mitglieder** (`schueler_ex`): nur die Anzahl. Solange die
  Liste nie gelesen wurde, steht dort „unbekannt“ statt 0.

Die Schule wird über ihre MATOOL-Kennung benannt (273 Rosenheim,
1734 Raubling, 1474 Stephanskirchen; änderbar mit `BEITRAEGE_SCHULEN`).
Sparten kommen aus `spartenliste`; verstanden werden Text („Kids,
Kickboxen“), JSON-Listen und JSON-Objekte. Was keinem Muster folgt, wird
ausgelassen statt geraten – die Feldwerte-Prüfung zeigt, was gelesen wurde.

**Einzugstag (Fälligkeit):** Die meisten Mitglieder werden zum 1. oder zum
15. eingezogen, ältere Verträge (älter als etwa zwei Jahre) auch an anderen
Tagen. Regel je Mitglied:

1. Steht im Feld `abweichenderEinzug` ein Tag oder Datum („7“, „zum 7.“,
   „07.03.“, „2026-03-07“), gilt dieser Tag.
2. Sonst gilt der **Tag des Vertragsbeginns** (`vertragsbeginn`).
3. Ist ein abweichender Einzug gesetzt, aber ohne lesbaren Tag (nur ein
   Häkchen), oder fehlt der Vertragsbeginn, bleibt der Tag **unklar**: nicht
   in den Tagessummen, aber in der Monatssumme und sichtbar gelistet.

Die Klassenauswertung zeigt je Mitglied Tag und Quelle und markiert Verträge,
die jünger als zwei Jahre sind und trotzdem nicht am 1./15. eingezogen
werden – daran fällt sofort auf, falls die Regel nicht stimmt. Steht der
abweichende Tag in einem anderen Feld, `BEITRAEGE_EINZUG_FELD` umstellen.

Je Mitglied gilt:

| Fall | Ergebnis |
|---|---|
| Kundenart oder Vertrag enthält ein Stilllegungsmuster | nicht eingerechnet, Grund `stillgelegt` |
| Stammdaten noch nicht gelesen | nicht eingerechnet, Grund `stammdaten_fehlen` |
| Beitrag nicht eindeutig lesbar (z. B. „auf Anfrage“) | nicht eingerechnet, Grund `beitrag_unlesbar` |
| Beitrag leer | eingerechnet mit 0,00 € (z. B. Trainer) |
| sonst | eingerechnet mit Monatsbeitrag |

Die Übersicht ist nur **vollständig**, wenn die Mitgliederliste gelesen ist
und kein aktives Mitglied fehlt. Gerechnet wird in Cent, Beträge wie
`49,90`, `49.90`, `1.234,56 €` oder `49,-` werden erkannt; mehrdeutige Werte
wie `1,234` werden nicht geraten, sondern gemeldet.

Die Jahresgebühr steht informativ in der Datei, ist aber **nicht** in der
Monatssumme enthalten.

## Regeln anpassen

Drei optionale Worker-Variablen (in `wrangler.jsonc` unter `env.staging.vars`
oder im Cloudflare-Dashboard als Variable, kein Secret nötig):

| Variable | Standard | Bedeutung |
|---|---|---|
| `BEITRAEGE_BETRAGSBEZUG` | `monat` | `monat`: MATOOL-`beitrag` ist schon der Monatsbetrag. `zahlungsperiode`: `beitrag` gilt je Zahlungsperiode und wird umgerechnet (vierteljährlich ÷ 3, halbjährlich ÷ 6, jährlich ÷ 12). |
| `BEITRAEGE_STILLLEGUNG_FELDER` | `kundenart,vertrag` | Felder, in denen eine Stilllegung steht. |
| `BEITRAEGE_STILLLEGUNG_MUSTER` | `stillgelegt,stillleg,stilleg,ruhend,ruhezeit,pausiert` | Teiltexte ohne Groß-/Kleinschreibung. `=Wert` verlangt exakte Gleichheit, z. B. `=3` für einen Kundenart-Code. |
| `BEITRAEGE_SCHULEN` | `273=Rosenheim,1734=Raubling,1474=Stephanskirchen` | Zuordnung MATOOL-Schulkennung → Name. Unbekannte Kennungen erscheinen unverändert. |
| `BEITRAEGE_EINZUG_FELD` | `abweichenderEinzug` | Feld mit einem abweichenden Einzugstag; ohne Eintrag gilt der Vertragsbeginn. Erlaubt: `abweichenderEinzug`, `autPreisDatum`, `autPreisTurnus`, `kundenart`, `vertrag`, `zahlart`, `zahlungsperiode` (feste Liste, damit nie Bank- oder Geburtsdaten in der Feldwerte-Prüfung landen). |

Eine ungültige Einstellung führt zu einer Fehlermeldung statt zu einer
falschen Summe.

## Vor dem ersten echten Versand prüfen

In der Klassenauswertung unter **`/beitraege` → Regeln und Feldwerte
prüfen** steht, welche Werte `kundenart`, `vertrag`, `zahlungsperiode`,
`zahlart`, `schule` und die gelesenen Sparten im Bestand tatsächlich haben,
jeweils mit Anzahl. Steht bei `schule` eine Zahl statt eines Namens,
`BEITRAEGE_SCHULEN` ergänzen.

1. **Stilllegung:** Taucht dort ein Wert auf, der eine Stilllegung bedeutet
   (z. B. Kundenart „Ruhend“ oder ein Code)? Falls die Standardmuster ihn
   nicht treffen, `BEITRAEGE_STILLLEGUNG_MUSTER` ergänzen.
2. **Betragsbezug:** Ein Mitglied mit vierteljährlicher Zahlung in MATOOL
   öffnen. Steht bei „Beitrag“ der Monats- oder der Quartalsbetrag? Bei
   Quartalsbetrag `BEITRAEGE_BETRAGSBEZUG=zahlungsperiode` setzen.
3. **Stichprobe:** Drei Mitglieder aus der Tabelle mit MATOOL vergleichen.
4. **Vollständigkeit:** Der Hinweis über den Kacheln muss „Vollständig“
   zeigen. Fehlende Stammdaten lädt der stündliche Abruf nach (150 Mitglieder
   je Lauf, montags bis freitags 9 bis 19 Uhr).

## Schnittstellen

| Aufruf | Zugang | Inhalt |
|---|---|---|
| `GET /api/checkin/v1/beitraege?stichtag=JJJJ-MM-TT` | `CHECKIN_SERVICE_TOKEN` | Heute: Live-Stand; 1. oder 15. in der Vergangenheit: gesicherter Stand. Je Mitglied Name, Nr., Schule, Sparten, Vertrag, Einzugstag samt Quelle, Jahresgebührdatum, Beträge in Cent; Summen gesamt und je Einzugstag (1–31); Feldwerte |
| `GET /api/checkin/v1/beitraege/stichtage` | `CHECKIN_SERVICE_TOKEN` | Alle gesicherten Stichtage (1./15.) mit Kennzahlen und Summen je Einzugstag (ohne Personen), neueste zuerst |
| `GET /api/zapier/v1/beitraege?stichtag=JJJJ-MM-TT` | Zapier-Service-Token | Summen, Einzelposten und XML-Text für die Zapier-App |

Die früheren Dashboard-Routen `/api/admin/v1/beitraege(.xml)` und der
Bereich „Beiträge“ im Hub-Dashboard sind entfallen.

Bei **Zapier** gilt ohne `stichtag` das heutige Datum in Europe/Berlin; der
Stichtag ist dort nur Beschriftung und Dateiname
(`beitragsuebersicht_2026-10-01.xml`), gerechnet wird mit dem aktuellen
Bestand. Die **Klassenauswertung** bekommt für einen vergangenen Tag
dagegen den damals gesicherten Stand (nur 1. und 15.); für einen Tag ohne Sicherung antwortet
der Hub mit 404 (`beitraege_stichtag_nicht_gesichert`), für einen Tag in der
Zukunft mit 400.

## Stichtage: Sicherung am 1. und 15.

MATOOL und der Hub kennen nur den aktuellen Bestand. Damit man später sehen
kann, was an einem vergangenen 1. oder 15. fällig war, sichert der Hub an
genau diesen beiden Tagen den Stand (Tabelle `beitrags_stichtage`,
Migration 0011). Andere Tage werden nicht gespeichert:

- nach jedem stündlichen Abruf (montags bis freitags 9 bis 19 Uhr) und
- im **Tagesabschluss** um 21:30 UTC (22:30/23:30 Uhr in Berlin, Cron
  `30 21 * * *`). Der ruft MATOOL nicht ab, sorgt aber dafür, dass auch ein
  1. oder 15. am Wochenende oder Feiertag einen Stand hat – dann mit dem
  letzten bekannten Datenstand, der im Stand vermerkt ist. An allen anderen
  Tagen tut er nichts.

Je Stichtag gilt der **letzte vollständige** Stand; ein unvollständiger
ersetzt nie einen vollständigen. Namen und Beträge liegen verschlüsselt, nur
die Summen (gesamt und je Einzugstag 1–31) stehen für den Verlauf im
Klartext. Für Einzüge vom 2. bis 14. nimmt die Klassenauswertung den Stand
vom 1., für den 16. bis 31. den Stand vom 15.

Ältere Tage gibt es erst ab Inbetriebnahme; rückwirkend lässt sich nichts
rekonstruieren.

## Anbindung der Klassenauswertung (einmalig)

1. Zufälligen Token erzeugen (mindestens 32 Zeichen, z. B.
   `openssl rand -hex 32`) und im Passwortmanager ablegen.
2. **Hub:** `pnpm exec wrangler secret put CHECKIN_SERVICE_TOKEN --env staging`
   (oder Cloudflare-Dashboard → `matool-middleware-staging` → Settings →
   Variables and Secrets, Typ „Secret“).
3. **Klassenauswertung:** denselben Wert als `HUB_BEITRAEGE_TOKEN` setzen,
   dazu `BEITRAEGE_BENUTZER` und `BEITRAEGE_PASSWORT` (siehe README dort).
4. Migration 0011 einspielen: `pnpm run db:migrate:staging`, dann deployen.
5. Steht der Hub später hinter Cloudflare Access, in der Klassenauswertung
   zusätzlich `HUB_ACCESS_CLIENT_ID` und `HUB_ACCESS_CLIENT_SECRET` eines
   Access-Service-Tokens setzen.

## Aufbau der XML-Datei

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beitragsuebersicht version="1" erstellt_am="2026-10-01T05:00:00.000Z" stichtag="2026-10-01" waehrung="EUR">
  <zusammenfassung>
    <monatssumme>1856.50</monatssumme>
    <jahresgebuehr_summe>240.00</jahresgebuehr_summe>
    <anzahl_mitglieder_gesamt>40</anzahl_mitglieder_gesamt>
    <anzahl_eingerechnet>32</anzahl_eingerechnet>
    <anzahl_mit_beitrag>31</anzahl_mit_beitrag>
    <anzahl_ohne_beitrag>1</anzahl_ohne_beitrag>
    <anzahl_stillgelegt>5</anzahl_stillgelegt>
    <anzahl_stammdaten_fehlen>0</anzahl_stammdaten_fehlen>
    <anzahl_nicht_berechenbar>0</anzahl_nicht_berechenbar>
    <vollstaendig>true</vollstaendig>
    <datenstand_aeltester>2026-09-30T07:00:00.000Z</datenstand_aeltester>
    <datenstand_neuester>2026-09-30T16:00:00.000Z</datenstand_neuester>
    <betragsbezug>monat</betragsbezug>
  </zusammenfassung>
  <mitglieder anzahl="32">
    <mitglied matool_id="90001" mitgliedsnummer="M-1">
      <vorname>Beispiel</vorname>
      <nachname>Mitglied</nachname>
      <vertrag>Beispielvertrag</vertrag>
      <kundenart>Mitglied</kundenart>
      <zahlungsperiode>monatlich</zahlungsperiode>
      <zahlart>Lastschrift</zahlart>
      <beitrag>59.90</beitrag>
      <monatsbeitrag>59.90</monatsbeitrag>
    </mitglied>
    <!-- … weitere Mitglieder, sortiert nach Nachname und Vorname … -->
  </mitglieder>
  <nicht_eingerechnet anzahl="5">
    <mitglied matool_id="90003" mitgliedsnummer="M-3" grund="stillgelegt">
      <vorname>Ruhendes</vorname>
      <nachname>Beispiel</nachname>
      <vertrag>Beispielvertrag</vertrag>
      <kundenart>Stillgelegt</kundenart>
      <detail>kundenart: Stillgelegt</detail>
    </mitglied>
    <!-- … -->
  </nicht_eingerechnet>
</beitragsuebersicht>
```

Beträge stehen mit Punkt als Dezimaltrenner, damit Excel, Google Sheets und
Buchhaltungsprogramme sie beim Import als Zahl lesen. Für E-Mail-Texte liefert
Zapier zusätzlich `monatssumme_text` („1.856,50 €“).

## Zapier-App aktualisieren

Die private App enthält jetzt die Aktion **Beitragsübersicht erstellen**
(`beitragsuebersicht`). Eingaben:

- **Stichtag** (optional, `JJJJ-MM-TT`; leer = heute)
- **Bei unvollständigen Daten**: `Abbrechen und als Fehler melden`
  (empfohlen) oder `Trotzdem erstellen`

Ausgaben: alle Summen und Zähler, `xml_datei` (Datei für Anhang oder Upload),
`dateiname`, `mitglieder` und `nicht_eingerechnet` als Listen.

## Ausrollen

Beides wird erst mit dem Merge nach `main` live. Ein Push auf einen
Feature-Branch baut weder den Worker in Cloudflare noch die Zapier-App.

**Worker (Cloudflare):** Merge nach `main` → Cloudflare baut und deployt
`matool-middleware-staging`, die neue Version erscheint in der Version
History. Ohne verbundenen Cloudflare-Build von Hand:
`pnpm run deploy:staging`.

**Zapier-App:** Der Workflow `.github/workflows/zapier-app.yml` lädt die App
automatisch hoch, sobald sich `zapier-app/` auf `main` ändert. Einmalig
einzurichten:

1. Zapier Developer Platform → oben rechts **Settings** → **Deploy Keys** →
   neuen Key erzeugen und kopieren.
2. GitHub → Repository → **Settings → Secrets and variables → Actions** →
   **New repository secret**, Name `ZAPIER_DEPLOY_KEY`, Wert einfügen.
3. Liegt der Merge schon zurück: GitHub → **Actions** → „Zapier-App
   veröffentlichen“ → **Run workflow**.

Ohne Secret überspringt der automatische Lauf den Upload mit einer Warnung.

Hochgeladen wird die Version aus `zapier-app/package.json` (die
Beitragsübersicht kam mit **1.2.0**). Eine neue Version bekommt automatisch
`MATOOL_MIDDLEWARE_ORIGIN`, ist aber noch nicht freigeschaltet:

4. Zapier Developer Platform → App „KwonRo MATOOL Middleware“ → **Versions**
   → bei der neuen Version **Promote**. Neue Zap-Schritte nutzen dann diese
   Version.
5. Optional **Migrate** von der alten auf die neue Version, damit auch
   bestehende Zaps umziehen. Ohne Migration laufen sie unverändert auf der
   alten Version weiter.

Für jede spätere App-Änderung die Versionsnummer in `package.json` erhöhen.

Lokal geht es weiterhin mit `zapier-platform login` und danach
`pnpm --dir zapier-app run zapier:push`.

## Bauplan für den Zap (nächster Schritt)

Ein Zap statt zwei, damit Änderungen nur einmal gepflegt werden:

1. **Trigger – Schedule by Zapier → Every Day**, Uhrzeit 07:00,
   Zeitzone Europe/Berlin, „Trigger on weekends?“ = Ja.
2. **Filter by Zapier** – nur weiter, wenn *Day of Month* (Zahl) gleich `1`
   **oder** gleich `15` ist. Gestoppte Filterläufe kosten keine Tasks.
3. **MATOOL Middleware → Beitragsübersicht erstellen**, Stichtag leer,
   „Abbrechen und als Fehler melden“.
4. **Versand**, z. B. Gmail „Send Email“ mit `XML-Datei` als Anhang und
   `Monatssumme formatiert` im Text, oder Google Drive „Upload File“.

Bricht Schritt 3 wegen unvollständiger Daten ab, meldet Zapier den Fehler per
E-Mail. Dann in der Klassenauswertung unter `/beitraege` (Status „Nicht
berechenbar“) nachsehen und den Zap nach dem nächsten Abruf mit „Replay“
erneut ausführen.
