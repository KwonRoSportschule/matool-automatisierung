# Anhang: Paritaetsnachweis und Zielabgleich

Version 1.0 · Stand 25. August 2026 · Ergaenzt `sync-spezifikation.md`

Dieser Anhang schliesst zwei Luecken der Hauptspezifikation: Er ordnet jedes
formulierte Ziel einem messbaren Zustand zu, und er legt fest, wie
Gleichstand zwischen MATOOL und Datenbank **nachgewiesen** statt nur
behauptet wird.

## 1. Zielabgleich

Fuer jedes Ziel: was erreicht ist, wo die Grenze liegt, und was sie
verschieben wuerde.

### Z1 Vollstaendige Anzeige je Person

| | |
|---|---|
| Erreicht | Interessenten: 3.489 Personen, alle Formularfelder in einem Datensatz |
| Offen | Mitglieder: Liste vollstaendig (563), Stammdaten in Arbeit |
| Grenze | keine technische |
| Nachweis | Pruefpunkt 7 der Hauptspezifikation |

### Z2 Beidseitige Synchronisation in Echtzeit

| | |
|---|---|
| Erreicht | Richtung MATOOL zur Datenbank, stuendlich |
| Entworfen | Rueckrichtung vollstaendig, Abschnitt 14 der Hauptspezifikation |
| Grenze | **Echtzeit ist unerreichbar.** MATOOL hat keine API, keine Webhooks, keinen Ereigniskanal. Ohne Meldung von aussen bleibt nur Abfragen. |
| Ersatz | Verzoegerungsbudget, Abschnitt 15: Bestandsaenderung 5 Minuten, Feldaenderung 60 Minuten, Einzelperson auf Anforderung 10 Sekunden |
| Was die Grenze verschiebt | Webhook, lesender Datenbankzugang oder ein Aenderungsprotokoll als Abrufpunkt. Alle drei liegen beim Anbieter. |

### Z3 Datenkonsistenz in beide Richtungen

| | |
|---|---|
| Erreicht | Richtung MATOOL zur Datenbank ueber Inhaltshash je Datensatz |
| Entworfen | Rueckrichtung mit Konfliktabbruch und Nachpruefung |
| Grenze | MATOOL kennt keine Versionskennung und keine Sperre |
| Ersatz | Lesen unmittelbar vor Schreiben, Vergleich gegen `base_hash`, Abbruch bei Abweichung |
| Restrisiko | rund eine Sekunde zwischen Pruefung und Senden |

### Z4 Loeschungen sofort abgebildet

| | |
|---|---|
| Erreicht | noch nicht; `change_kind` kennt nur `created` und `updated` |
| Geplant | Kennzeichnung statt Entfernen, Abschnitt 6.2 |
| Grenze | „sofort" setzt eine Meldung voraus, die MATOOL nicht sendet |
| Ersatz | Schnellbahn alle 5 Minuten erkennt eine sinkende Gesamtzahl; gefuehrt wird die Loeschung nach dem zweiten vollstaendigen Lauf |
| Warum nicht schneller gefuehrt | Ein unvollstaendiger Abruf wuerde sonst eine Loeschwelle ausloesen. Die Verzoegerung ist Absicht. |

### Z5 Stuendliche automatische Pruefung

| | |
|---|---|
| Erreicht | Cron `0 7-18 * * mon-fri` in UTC, Fensterpruefung gegen `Europe/Berlin` |
| Grenze | keine |
| Nachweis | Pruefpunkt 9 der Hauptspezifikation |

### Z6 Gleichstand 1:1 jederzeit

| | |
|---|---|
| Erreicht | Mengenpruefung gegen die von MATOOL genannte Gesamtzahl |
| Offen | Feldweiser Nachweis; dieser Anhang legt ihn fest |
| Grenze | „jederzeit" ist bei Abfragebetrieb nicht haltbar: zwischen zwei Laeufen kann MATOOL abweichen |
| Ersatz | **Nachweisbarer Gleichstand zum Pruefzeitpunkt** plus Angabe, wie alt der Stand hoechstens ist |

## 2. Paritaetsnachweis

Ein Abgleich, der nur Datensaetze zaehlt, uebersieht falsche Feldwerte. Der
Paritaetslauf vergleicht deshalb Inhalte.

### 2.1 Verfahren

1. Bereich vollstaendig aus MATOOL lesen, wie im normalen Lauf.
2. Je Datensatz den Inhaltshash bilden.
3. Gegen den gespeicherten Hash stellen.
4. Vier Mengen bilden:
   - **gleich** — Hash stimmt ueberein
   - **abweichend** — Hash unterschiedlich
   - **fehlt in der Datenbank** — in MATOOL vorhanden, bei uns nicht
   - **ueberzaehlig** — bei uns vorhanden, in MATOOL nicht mehr
5. Ergebnis in `matool_parity_runs` schreiben.
6. Abweichende und fehlende Datensaetze sofort nachziehen.
7. Ueberzaehlige der Loescherkennung uebergeben, nicht direkt entfernen.

Schritt 6 macht den Lauf **selbstheilend**: Eine erkannte Abweichung wird im
selben Durchgang korrigiert, nicht nur gemeldet.

### 2.2 Takt

| Umfang | Takt | Kosten |
|---|---|---|
| Listenfelder beider Bereiche | taeglich, erster Lauf des Tages | ein vollstaendiger Listenlauf |
| Stammdaten, Stichprobe 50 Personen | taeglich | 50 Abrufe |
| Stammdaten vollstaendig | woechentlich, ausserhalb der Bueozeit | ein voller Detaildurchlauf |

Die taegliche Stichprobe rotiert, sodass jeder Datensatz innerhalb einer
Woche mindestens einmal feldweise geprueft wird.

### 2.3 Schema

    CREATE TABLE matool_parity_runs (
      parity_id     TEXT PRIMARY KEY,
      area          TEXT NOT NULL,
      scope         TEXT NOT NULL,   -- liste | stichprobe | vollstaendig
      started_at    TEXT NOT NULL,
      finished_at   TEXT NOT NULL,
      matool_count  INTEGER NOT NULL,
      db_count      INTEGER NOT NULL,
      equal_count   INTEGER NOT NULL,
      differing     INTEGER NOT NULL,
      missing_in_db INTEGER NOT NULL,
      surplus_in_db INTEGER NOT NULL,
      repaired      INTEGER NOT NULL,
      status        TEXT NOT NULL    -- parity | drift | failed
    );

    CREATE INDEX idx_matool_parity_runs_zeit
      ON matool_parity_runs (area, started_at DESC);

### 2.4 Bewertung

| Ergebnis | Bedeutung | Folge |
|---|---|---|
| `differing = 0`, `missing_in_db = 0`, Mengen gleich | Gleichstand zum Pruefzeitpunkt belegt | Vermerk im Dashboard |
| `differing > 0` | Feldabweichung | Sofort nachgezogen, danach erneut geprueft |
| `missing_in_db > 0` | Datensatz fehlt | Sofort nachgezogen |
| `surplus_in_db > 0` | Kandidat fuer Loeschung | An Loescherkennung, Abschnitt 7.3 |
| Mehr als 10 Prozent auffaellig | Verdacht auf unvollstaendigen Abruf | Lauf verworfen, nichts geaendert, Alarm |

### 2.5 Anzeige

Das Dashboard fuehrt je Bereich zwei Angaben, die ohne Fachkenntnis lesbar
sind:

- **Zuletzt belegter Gleichstand** — Zeitpunkt des letzten Laufs mit
  `status = parity`
- **Hoechstalter des Bestands** — Zeit seit dem letzten vollstaendigen
  Abgleich

Damit ist die Frage „stimmen die Daten?" nicht mit einem Gefuehl, sondern
mit einem Zeitstempel zu beantworten.

## 3. Was zugesichert wird

Statt „1:1 jederzeit", das im Abfragebetrieb niemand halten kann:

1. **Gleichstand ist zu jedem Pruefzeitpunkt nachgewiesen** — feldweise, nicht
   nur nach Anzahl.
2. **Jede Abweichung wird im selben Lauf korrigiert**, nicht nur gemeldet.
3. **Das Hoechstalter des Bestands ist jederzeit ablesbar** und durch das
   Verzoegerungsbudget nach oben begrenzt.
4. **Kein unvollstaendiger Abruf veraendert Daten** — weder loeschend noch
   korrigierend.

## 4. Umsetzung

| Stufe | Inhalt | Voraussetzung |
|---|---|---|
| P1 | Tabelle und taeglicher Listenvergleich | keine |
| P2 | Rotierende Stichprobe der Stammdaten | Mitglieder-Stammdaten vorhanden |
| P3 | Selbstheilung: Abweichungen im selben Lauf nachziehen | P1 |
| P4 | Anzeige im Dashboard | P1 |
| P5 | Woechentlicher Volldurchlauf | Workers Paid |
