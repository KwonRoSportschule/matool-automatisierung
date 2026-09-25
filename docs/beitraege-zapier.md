# Beitragsübersicht: Hub-Funktion und Zapier-Ablauf

Stand: 25. September 2026

## Ziel

Am 1. und am 15. jedes Monats erstellt Zapier eine XML-Datei mit allen nicht
stillgelegten Mitgliedern, ihrem Monatsbeitrag und der Monatssumme aller
Beiträge.

Der Hub rechnet, Zapier verteilt. Die Berechnung liegt vollständig im Hub,
damit Dashboard und Zapier garantiert dieselbe Zahl zeigen und die Regeln an
einer Stelle geändert werden.

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
  `zahlungsperiode`, `kundenart`, `vertrag`, `jahresgebuehr`, `zahlart`,
  Name und Mitgliedsnummer. Bank-, Geburts- und Kontaktdaten werden für die
  Beitragsübersicht nicht einmal gelesen.

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

Eine ungültige Einstellung führt zu einer Fehlermeldung statt zu einer
falschen Summe.

## Vor dem ersten echten Versand prüfen

Im Dashboard unter **Beiträge → Regeln und Feldwerte prüfen** steht, welche
Werte `kundenart`, `vertrag`, `zahlungsperiode` und `zahlart` im Bestand
tatsächlich haben, jeweils mit Anzahl.

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
| `GET /api/admin/v1/beitraege?stichtag=JJJJ-MM-TT` | Dashboard-Anmeldung | Übersicht als JSON plus Feldwerte; Namen maskiert, solange `PUBLIC_DASHBOARD_PLAINTEXT` nicht `true` ist |
| `GET /api/admin/v1/beitraege.xml?stichtag=JJJJ-MM-TT` | Dashboard-Anmeldung | XML-Datei als Download |
| `GET /api/zapier/v1/beitraege?stichtag=JJJJ-MM-TT` | Zapier-Service-Token | Summen, Einzelposten und XML-Text für die Zapier-App |

Ohne `stichtag` gilt das heutige Datum in Europe/Berlin. Der Stichtag ist
Beschriftung und Dateiname (`beitragsuebersicht_2026-10-01.xml`); gerechnet
wird immer mit dem aktuellen gespeicherten Bestand.

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
Die Version bleibt `0.0.0` und wird überschrieben; bestehende Zaps und der
hinterlegte `MATOOL_MIDDLEWARE_ORIGIN` laufen unverändert weiter.

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
E-Mail. Dann im Hub unter „Beiträge“ nachsehen und den Zap nach dem nächsten
Abruf mit „Replay“ erneut ausführen.
