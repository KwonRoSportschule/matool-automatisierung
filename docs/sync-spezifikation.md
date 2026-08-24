# Spezifikation: Datenabgleich MATOOL und Middleware

Version 1.1 · Stand 24. August 2026 · Status: Entwurf zur Freigabe

Gestaltete Fassung: https://claude.ai/code/artifact/a64132f1-9414-488b-bdd3-77be62f105a8

## 1. Geltungsbereich

Im Geltungsbereich: **Interessenten und Mitglieder**, jeweils Stammdaten und
Verlauf, ein Datensatz je Person.

Ausserhalb: Klassen, Newsletter, Pruefungen, Artikel, Lager, Check-ins,
Archiv, Telemetrie, Berichte, Karte. Am 24.08.2026 aus dem Abgleich entfernt.

Die Middleware verschickt keine Nachrichten. Kontaktstrecken entstehen
ausschliesslich in Zapier.

## 2. Machbarkeit

Zwei urspruenglich formulierte Ziele sind mit MATOOL nicht erreichbar.

### 2.1 Echtzeit im Wortsinn ist nicht erreichbar

MATOOL hat keine API, keine Webhooks, keinen Ereigniskanal. Ohne Zutun des
Anbieters bleibt nur wiederholtes Abfragen.

Statt einer nicht einloesbaren Zusage legt Abschnitt 15 ein gestuftes
Verfahren mit verbindlichem Verzoegerungsbudget fest: Bestandsaenderungen
innerhalb von fuenf Minuten, vollstaendiger Abgleich stuendlich,
Sofortpruefung auf Anforderung.

### 2.2 Rueckschreiben ist moeglich, aber bedingt

Ein Schreibweg existiert (POST auf `/index.php?show=interessenten` mit
`todo=2` und allen 32 Feldern). Er uebertraegt alle Felder auf einmal, MATOOL
kennt keine Versionskennung und keine Sperre, und ein fehlerhafter Vorgang ist
dort nicht zurueckzunehmen.

Das schliesst die Rueckrichtung nicht aus, verlangt aber ein Verfahren, das
den fehlenden Schutz auf unserer Seite nachbildet. Es ist in Abschnitt 14
vollstaendig festgelegt. Bis zur schriftlichen Freigabe bleibt der Betrieb
einseitig: **MATOOL fuehrt, die Datenbank ist die Kopie.**

## 3. Ist-Stand (gemessen 24.08.2026)

| Bereich | Datensaetze | Bewertung |
|---|---:|---|
| Interessenten | 3.492 | vollstaendig, benannt |
| Interessenten-Details | 3.492 | 1:1 zugeordnet |
| Mitglieder | 562 | nur Listenspalten |
| Mitglieder-Details | 0 | blockiert, siehe 13.1 |
| Rauschzeilen Mitglieder | 102 | aufraeumen |

562 entspricht exakt der MATOOL-Zahl aus der Zeile "Gefunden".

## 4. Architektur

Cloudflare Cron, Worker, MATOOL nur lesend, D1, danach Dashboard und Zapier.

- Eine Anmeldung je Lauf, gemeinsame Sitzung.
- Cron `0 7-18 * * mon-fri` in UTC, Pruefung gegen `Europe/Berlin`,
  Montag bis Freitag 9 bis 19 Uhr, Feiertage ausgenommen.
- Anfragebudget mit Zaehler, 700 ms Mindestabstand zwischen Anfragen.
- **Workers Paid ist Voraussetzung fuer den Regelbetrieb.** Der Free-Tarif
  erlaubt 50 externe Anfragen je Aufruf; benoetigt werden mehrere hundert.

## 5. MATOOL-Schnittstellen

Alle Aufrufe sind aus echten Browsersitzungen abgeleitet und im Betrieb
bestaetigt. Basis `https://core.matool.de`, PHP-Sitzung ueber Cookie.

| Aufruf | Parameter | Zweck | Belegt |
|---|---|---|---|
| GET `/index.php` | keine | Sitzungscookie | ja |
| POST `/index.php` | `mail`, `pass` | Anmeldung, Erfolg gleich 302 | ja |
| GET `/index.php?show=interessenten` | `offset` | Liste, 30 je Seite | ja |
| POST `/json/session_interessenten_open.php` | `interessenten_open`, `todo` mit Wert open oder close | Detailmaske | ja |
| GET `/index.php?show=schueler` | `offset` | Mitgliederliste | ja |
| POST `/json/schueler_daten.php` | `id`, `todo` leer | Mitglieder-Stammdaten | Format offen |
| POST `/index.php?show=interessenten` | `todo=2` und 32 Felder | Speichern | gesperrt |

Verbindliche Regeln:

- `redirect: "manual"`, Statuscodes werden ausgewertet.
- Anmeldung gilt nur als erfolgreich, wenn die Zielseite kein Anmeldeformular
  mehr enthaelt. MATOOL antwortet auf falsche Zugangsdaten mit HTTP 200.
- Weicht eine Antwort vom erwarteten Aufbau ab, schlaegt der Bereich fehl. Es
  wird kein Wert geraten und kein Teilergebnis gespeichert.
- Nur Host `core.matool.de` ueber HTTPS; Umleitungen auf andere Hosts werden
  abgebrochen.

## 6. Datenmodell

Bestehend: `matool_snapshots`, `matool_snapshot_changes`,
`matool_snapshot_runs`, `matool_sync_runs`, `interessenten_sync_jobs`.

### 6.2 Erforderliche Erweiterung: Loeschungen

`change_kind` kennt heute nur `created` und `updated`. Ein in MATOOL
geloeschter Datensatz bleibt stehen und ist nicht unterscheidbar.

    -- Migration 0005
    ALTER TABLE matool_snapshots ADD COLUMN deleted_at TEXT;
    ALTER TABLE matool_snapshots
      ADD COLUMN missing_since_runs INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_matool_snapshots_aktiv
      ON matool_snapshots (area, deleted_at);
    -- change_kind um 'deleted' erweitern (Tabellenneubau, SQLite)

Geloeschte Datensaetze werden gekennzeichnet, nicht entfernt. Das erhaelt den
Verlauf und erlaubt eine Ruecknahme bei Fehlalarm.

### 6.3 Ein Datensatz je Person

Listen- und Detailfelder werden beim **Lesen** zusammengefuehrt
(`json_patch`), nicht beim Schreiben. Sonst wuerde der stuendliche Listenlauf
die Detailfelder ueberschreiben, weil die Liste diese Felder nicht enthaelt.

## 7. Abgleichverfahren

1. Zeitfenster pruefen
2. Anmelden, genau einmal
3. Liste vollstaendig lesen, alle Seiten
4. Sollzahl aus der Zeile "Gefunden" erfassen
5. Mengenpruefung; Ist ungleich Soll bedeutet Lauf unvollstaendig
6. Neu und geaendert ueber SHA-256 des kanonischen Payloads bestimmen
7. Details nachladen, fehlende zuerst, danach die aeltesten
8. Fehlende kennzeichnen
9. Lauf abschliessen mit Mengen, Fehlern, Dauer

### 7.3 Loescherkennung mit Fehlalarmschutz

- Nur aus einem als vollstaendig bestaetigten Listenlauf.
- Fehlt ein Datensatz, wird `missing_since_runs` erhoeht.
- `deleted_at` wird erst ab dem zweiten vollstaendigen Lauf ohne ihn gesetzt.
- Taucht er wieder auf, werden Zaehler und Kennzeichnung zurueckgesetzt.
- Uebersteigt die Zahl der Fehlenden zehn Prozent des Bestands, wird der Lauf
  als auffaellig markiert und es wird nichts geloescht.

## 8. Konflikte und Fehlerfaelle

Es gibt keinen Schreibkonflikt zwischen den Systemen, da nur MATOOL schreibt.

| Fall | Regel |
|---|---|
| Aenderung waehrend des Laufs | Zuletzt gelesener Stand gewinnt, naechster Lauf korrigiert |
| Ueberschneidende Laeufe | Fortsetzbarer Auftrag, nur ein aktiver Lauf je Bereich |
| Kennungswechsel | Loeschung und Neuanlage, keine automatische Zusammenfuehrung |

| Fehler | Verhalten |
|---|---|
| MATOOL nicht erreichbar | Ein Wiederholungsversuch, dann Bereich fehlgeschlagen |
| Anmeldung fehlgeschlagen | Lauf abbrechen, kein Datenzugriff |
| Anfragekontingent erschoepft | Rest ueberspringen, naechster Lauf setzt fort |
| Antwortformat abweichend | Bereich fehlschlagen, nur Struktur protokollieren |
| Liste unvollstaendig | Lauf unvollstaendig, keine Loescherkennung |
| Lauf abgebrochen | Naechster Lauf setzt am letzten Block fort |

## 9. Ueberwachung

| Zustand | Schwelle | Stufe |
|---|---|---|
| Lauf ausgefallen | kein Erfolg seit zwei Stunden im Zeitfenster | kritisch |
| Bereich fehlgeschlagen | zwei Laeufe in Folge | kritisch |
| Mengenabweichung | Ist ungleich Soll | Warnung |
| Details unvollstaendig | mehr als fuenf Prozent nach 24 Stunden | Warnung |
| Viele Fehlende | mehr als zehn Prozent | kritisch, Loeschung ausgesetzt |
| Kontingent erreicht | Bereiche uebersprungen | Warnung |

Protokolliert werden nur Lauf-Kennung, Bereich, Mengen, Dauer und
Fehlerklasse. Keine Namen, keine Kontaktdaten, keine Rohantworten.

## 10. Ruecknahme

| Situation | Vorgehen |
|---|---|
| Fehlerhafte Version | Vorherige Worker-Version, Datenbank bleibt unberuehrt |
| Faelschlich geloescht | `deleted_at` leeren, die Nutzlast blieb erhalten |
| Falsche Feldzuordnung | Bereich leeren und neu einlesen, Verlauf bleibt |
| Abgleich sofort stoppen | Cron leeren und ausrollen |

## 11. Pruefverfahren

1. Zwei aufeinanderfolgende Laeufe erzeugen null Aenderungen.
2. Eine geaenderte Person erscheint als genau ein `updated`.
3. Eine neue Person erscheint als `created`.
4. Eine geloeschte Person gilt erst nach zwei vollstaendigen Laeufen als
   geloescht, nicht frueher.
5. Eine kuenstlich unvollstaendige Liste loest keine Loeschung aus.
6. Die Bestandszahl stimmt mit der Zahl aus "Gefunden" ueberein.
7. Stichprobe von zehn Personen: alle Felder stimmen mit MATOOL ueberein.
8. Ein abgebrochener Lauf wird fortgesetzt, ohne Dubletten anzulegen.
9. Ein Lauf ausserhalb des Zeitfensters fuehrt keinen Datenzugriff aus.
10. Kein Personenmerkmal in Protokollen oder Fehlermeldungen.

## 12. Umsetzungsplan

| Stufe | Inhalt | Stand |
|---|---|---|
| M1 | Interessenten vollstaendig, ein Datensatz je Person | erreicht |
| M2 | Mitglieder-Stammdaten | wartet auf 13.1 |
| M3 | Workers Paid aktivieren | wartet auf Freigabe |
| M4 | Loescherkennung und Mengenpruefung | geplant |
| M5 | Altbestaende bereinigen | geplant, Freigabe noetig |
| M6 | Beobachteter Regelbetrieb, ein Arbeitstag | geplant |
| M7 | Zapier verbunden, Testabruf ohne Kontakt | geplant |
| M8 | Produktionsumgebung | geplant |
| M9 | Schnellbahn und Sofortpruefung, Abschnitt 15 | geplant |
| M10 | Rueckrichtung im Trockenlauf, Abschnitt 14 | Freigabe noetig |
| M11 | Rueckrichtung scharf | Freigabe noetig |

M2 bis M4 sind unabhaengig und koennen parallel laufen. M6 setzt M3 voraus.

## 13. Benoetigte Zulieferungen

### 13.1 Aufzeichnung eines Mitglieder-Aufrufs, blockiert M2

`schueler_daten.php` antwortet in einem Format, das aus den vorliegenden
Aufzeichnungen nicht hervorgeht; sie enthalten die Anfragen, aber nicht die
Antworten. Drei Formate wurden geprueft und schlugen fehl.

Benoetigt: In MATOOL ein Mitglied oeffnen, dann in den Entwicklerwerkzeugen
unter Netzwerk per Rechtsklick "Save all as HAR with content" waehlen. Der
Zusatz "with content" ist entscheidend.

### 13.2 Entscheidungen

- Workers Paid buchen, noetig fuer M3 und M6
- Freigabe zum Loeschen der Altbestaende, noetig fuer M5
- Umgang mit Standorten Raubling, Rosenheim, Stephanskirchen
- Aufbewahrungsfrist fuer geloeschte Datensaetze, noetig fuer M4

### 13.3 Vor echten Personendaten

Das Staging-Dashboard ist ohne Anmeldung erreichbar und zeigt derzeit
Klartext, einschliesslich Bankverbindungen. Das ist fuer die Testphase
bewusst so eingestellt. Vor dem Betrieb mit echten Mitgliederdaten sind
erforderlich: `PUBLIC_DASHBOARD_PLAINTEXT` auf `false`, Cloudflare Access
einrichten, getrennte Produktionsdatenbank, MATOOL-Passwort rotieren.

## 14. Rueckrichtung: Datenbank nach MATOOL

Vollstaendiger Entwurf des Schreibwegs. Umsetzbar, aber erst nach
schriftlicher Freigabe zu aktivieren.

### 14.1 Voraussetzungen

1. Schriftliche Freigabe, welche Felder die Middleware fuehren darf. Ohne
   Eintrag in dieser Liste wird ein Feld nie geschrieben.
2. Erprobung in einem Testmandanten oder ausserhalb der Buerozeiten.
3. Trockenlauf ueber mindestens eine Woche: Auftraege werden vollstaendig
   vorbereitet und protokolliert, aber nicht gesendet.

### 14.2 Ablauf je Schreibvorgang

1. Auftrag entsteht aus Zapier oder Dashboard, mit `base_hash`
2. Detailmaske frisch lesen, `before_hash` bilden
3. `before_hash` ungleich `base_hash` bedeutet Abbruch, Auftrag pausiert
4. Vorher-Abbild des vollstaendigen Formulars sichern
5. Freigegebene Felder ersetzen, alle uebrigen aus dem frisch gelesenen
   Formular uebernehmen
6. Senden mit `todo=2`
7. Erneut lesen, `after_hash` bilden
8. Nur die beabsichtigten Felder veraendert bedeutet Erfolg, sonst Ruecknahme

Schritt 5 ist der Kern: Weil MATOOL alle Felder verlangt, stammen die nicht
gefuehrten Felder aus dem unmittelbar zuvor gelesenen Formular. Eine fremde
Aenderung kann so nur im Zeitraum zwischen Lesen und Senden verloren gehen,
nicht seit dem letzten Abgleich.

### 14.3 Wiederholungssicherheit

Jeder Auftrag traegt `intent_id` und `base_hash`. Ein bereits angewandter
Auftrag wird nie erneut gesendet. Bei unklarem Ausgang, etwa einer verlorenen
Antwort, entscheidet die Nachpruefung aus Schritt 7. Es wird niemals blind
wiederholt.

### 14.4 Konfliktaufloesung

| Fall | Aufloesung |
|---|---|
| Feld ausserhalb der Freigabeliste | MATOOL gewinnt immer |
| Freigegebenes Feld, `base_hash` passt | Auftrag wird angewandt |
| Datensatz zwischenzeitlich geaendert | Abbruch, Klaerungsliste, Mensch entscheidet |
| Zwei Auftraege fuer dieselbe Person | Nacheinander, zweiter prueft gegen neuen Stand |
| Datensatz in MATOOL geloescht | Auftrag verfaellt als obsolete |

### 14.5 Schema

    -- Migration 0006
    CREATE TABLE write_intents (
      intent_id     TEXT PRIMARY KEY,
      area          TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      base_hash     TEXT NOT NULL,
      fields_json   TEXT NOT NULL,
      before_json   TEXT,
      status        TEXT NOT NULL,
      origin        TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      applied_at    TEXT,
      verified      INTEGER NOT NULL DEFAULT 0,
      error_code    TEXT
    );
    CREATE INDEX idx_write_intents_offen
      ON write_intents (status, created_at);

### 14.6 Ruecknahme

Das Vorher-Abbild enthaelt das vollstaendige Formular. Eine Ruecknahme ist ein
erneuter Schreibvorgang mit genau diesem Inhalt und durchlaeuft dieselben
Schritte, ist also ebenso konfliktgeschuetzt wie der urspruengliche Vorgang.

### 14.7 Verbleibendes Risiko

Zwischen der Nachpruefung in Schritt 2 und dem Senden in Schritt 6 liegt rund
eine Sekunde. Eine Bearbeitung genau in diesem Fenster geht verloren. Das
Verfahren verkleinert das Risiko auf diese Sekunde, beseitigt es aber nicht.
MATOOL bietet keine Sperre. Diese Einschraenkung ist Teil der
Freigabeentscheidung.

## 15. Verzoegerungsbudget und Loescherkennung

Ersatz fuer die nicht erreichbare Echtzeit: ein gestuftes Verfahren mit
zugesicherten Obergrenzen statt einer unbestimmten Zusage.

### 15.1 Stufen

| Stufe | Takt | Umfang | Kosten je Lauf |
|---|---|---|---|
| Schnellbahn | 5 Minuten | Erste Listenseite und Gesamtzahl | 2 Anfragen |
| Ausloeser | bei Abweichung | Vollstaendiger Listenlauf des Bereichs | ca. 20 Anfragen |
| Vollabgleich | stuendlich | Beide Bereiche, Listen und Details | mehrere hundert |
| Sofortpruefung | auf Anforderung | Einzelne Person | 3 Anfragen |

### 15.2 Zugesicherte Obergrenzen

| Ereignis in MATOOL | Sichtbar in der Datenbank | Erkennungsweg |
|---|---|---|
| Neue Person angelegt | 5 Minuten | Gesamtzahl steigt, Ausloeser greift |
| Person geloescht | 5 Minuten erkannt, gefuehrt nach zweitem vollstaendigen Lauf | Gesamtzahl sinkt |
| Feld geaendert, Person bleibt | 60 Minuten | Vollabgleich, Hashvergleich |
| Einzelne Person auf Anforderung | 10 Sekunden | Sofortpruefung |

Die Schnellbahn erkennt Mengenaenderungen zuverlaessig, weil MATOOL die
Gesamtzahl selbst ausweist. Eine reine Feldaenderung ohne Mengenaenderung
bleibt bis zum naechsten Vollabgleich unentdeckt; dafuer gibt es ohne
Anbieterunterstuetzung keinen guenstigeren Weg.

### 15.3 Was echte Zustellung ermoeglichen wuerde

Alle drei Wege liegen beim Anbieter und sind vertraglich zu klaeren. Die
Middleware ist so gebaut, dass jeder davon ohne Umbau ergaenzt werden kann.

1. Webhook aus MATOOL auf einen Endpunkt der Middleware. Der bestehende
   Ereignisweg zu Zapier bliebe unveraendert, nur die Quelle wechselt vom
   Abfragen zum Empfangen.
2. Lesender Datenbankzugang oder Replikat. Damit entfiele das Blaettern;
   Aenderungen waeren ueber Zeitstempel direkt abfragbar.
3. Exportschnittstelle mit Aenderungsdatum. Ein Abruf der Form "alle
   Datensaetze geaendert seit X" wuerde den Vollabgleich auf Sekunden
   verkuerzen.

Bis dahin gelten die Obergrenzen aus 15.2 als vereinbarte Leistung.
