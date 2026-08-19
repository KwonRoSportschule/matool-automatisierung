# MATOOL Middleware Hub – V1-Todo- und Abnahmeplan

Stand: 19. August 2026  
Grundlage: Code-, Cloudflare-, D1-, MATOOL- und Zapier-Audit vom 19. August 2026

## Zweck dieses Dokuments

Dieses Dokument ist die zentrale Arbeitsliste bis zur produktionsreifen Version

1. Jeder offene Punkt bekommt eine eindeutige ID und wird einzeln bearbeitet.
   Ein Punkt ist erst erledigt, wenn alle Abnahmekriterien bestanden und die
   Nachweise eingetragen wurden.

Arbeitsregel:

1. Der Benutzer nennt genau die Todo-ID, mit der begonnen werden soll.
2. Vorher wird kein anderer Punkt umgesetzt.
3. Fehlende Informationen, HAR-Aufnahmen, Zugänge oder Entscheidungen werdena
   beim Benutzer angefragt und nicht geraten.
4. Nach der Umsetzung wird nur der freigegebene Punkt getestet.
5. Erst nach bestandener Abnahme wird `[ ]` zu `[x]` geändert.
6. Fehler oder neue Blocker werden unter der betroffenen Todo-ID dokumentiert,
   nicht nebenbei behoben.

## Verbindlicher V1-Umfang

Die Anwendung ist ausschließlich der Datenübertragungshub zwischen MATOOL und
Zapier.

- MATOOL wird ausschließlich gelesen. Der Hub darf dort nichts ändern.
- Der Hub kontaktiert keine Interessenten, Mitglieder oder andere Personen.
- Nachrichten, Zeitregeln und Kontaktaktionen werden später ausschließlich vom
  Benutzer in Zapier gebaut.
- Die alte First-Trial-/Kontaktzustellung bleibt deaktiviert.
- Der automatische Abruf läuft montags bis freitags stündlich von 09:00 bis
  19:00 Uhr und überspringt die bestätigten gesetzlichen Feiertage.
- Neue und geänderte MATOOL-Daten werden in Cloudflare D1 gespeichert.
- Löschungen beziehungsweise Inaktivität müssen nachvollziehbar abgebildet
  werden, damit D1 den aktuellen MATOOL-Bestand nicht still verfälscht.
- Zapier erhält Datensatzänderungen verlustfrei und mindestens einmal mit einer
  stabilen Ereignis-ID. Zapier darf Wiederholungen anhand dieser ID erkennen.
- Der Hub zeigt den tatsächlichen Status, Laufverlauf, Datenbestand und Fehler
  an. Ein unvollständiger Lauf darf nicht als gesund erscheinen.
- V1 umfasst die heute bekannten 13 Datenbereiche:
  Interessenten, Interessenten-Details, Klassen, Schüler, Check-in, Prüfungen,
  Artikel, Lager, Newsletter, Archiv, Telemetrie, Berichte und Karte.

## Nicht Bestandteil von V1

- Nachrichten oder Anrufe an Interessenten oder Mitglieder
- Die fachliche Zapier-Automatisierung nach der Datenübergabe
- Neue Cloudflare-Produkte wie Queues, R2, KV oder Durable Objects, sofern sie
  nicht später als zwingende Lösung für einen freigegebenen V1-Blocker
  beschlossen werden
- Optische Erweiterungen ohne Einfluss auf Funktion, Datenqualität oder
  Betriebsstatus
- Zusätzliche Integrationen neben MATOOL, D1 und Zapier

## Definition: Wann V1 fertig ist

V1 ist erst fertig, wenn alle folgenden Punkte erfüllt sind:

- [ ] Alle kritischen und hohen Todos dieses Dokuments sind erledigt.

- [ ] Die Produktionsumgebung ist über die endgültige Domain erreichbar.

- [ ] Kein anonymer Besucher kann unfreigegebene personenbezogene Daten oder
  
      Verwaltungsfunktionen aufrufen.

- [ ] Cron und manueller Abruf können nicht gleichzeitig als schreibende Läufe
  
      arbeiten.

- [ ] Abgebrochene Läufe bleiben nicht dauerhaft auf `running`.

- [ ] Jeder Datenbereich besitzt einen vollständigen, nachvollziehbaren
  
      Quell-/D1-Abgleich.

- [ ] Keine Pagination, Detailansicht oder fachlich notwendige Relation fehlt.

- [ ] Unerwartet leere oder stark verkleinerte Abrufe werden nicht als Erfolg
  
      gespeichert.

- [ ] Ein vollständiger Lauf bleibt mit mindestens 20 Prozent Reserve unter
  
      der Cloudflare-Cron-Grenze von 15 Minuten, also höchstens 12 Minuten.

- [ ] Der produktive Zap verwendet `matool_record_v2`; der Legacy-Trigger wird
  
      nicht mehr benutzt.

- [ ] Eine getestete MATOOL-Änderung erscheint genau einmal fachlich in D1 und
  
      wird mit stabiler ID an Zapier zugestellt. Technische Wiederholungen
      dürfen keine doppelte Zapier-Aktion verursachen.

- [ ] Mindestens ein kompletter Arbeitstag mit 11 vorgesehenen Stundenläufen
  
      endet ohne hängenden oder unvollständigen Lauf.

- [ ] Alle 243 bestehenden automatisierten Tests und alle ergänzten
  
      V1-Abnahmetests bestehen.

- [ ] Ein dokumentierter Rollback auf die vorherige Worker-Version ist möglich.

---

## Aktueller bestätigter Ausgangsstand

### Cloudflare und Betrieb

| Punkt                    | Stand am 19.08.2026                                            |
| ------------------------ | -------------------------------------------------------------- |
| Cloudflare-Tarif         | Workers Paid laut Benutzer/Cloudflare-Oberfläche aktiv         |
| Aktiver Staging-Worker   | `matool-middleware-staging`                                    |
| Aktive Live-Version      | `e0833ded-e811-4b22-b8c6-2cc5083238a6` vom 11.08.2026          |
| Staging-URL              | `https://matool-middleware-staging.soft-hill-4630.workers.dev` |
| Cron                     | `0 7-18 * * mon-fri` plus Berliner Zeitfenster im Worker       |
| D1                       | `matool-middleware-staging`, Region EU/EEUR, 9,79 MB           |
| Verwendete Dienste       | Worker, Cron Trigger, D1, Static Assets, Logs/Observability    |
| Nicht verwendete Dienste | KV, R2, Queues, Durable Objects, Analytics Engine              |
| Migrationen live         | 0001 bis 0004 angewendet; 0005 noch offen                      |
| Zapier-Ausgang           | `OUTBOUND_DELIVERY_ENABLED=false`                              |
| Zapier-App live          | nur private Version `0.0.0` vom 10.08.2026 nachgewiesen        |
| Zapier-Subscription      | keine aktive v2-Snapshot-Subscription nachgewiesen             |
| Öffentlicher Zugriff     | Full Access und Klartext aktuell aktiv                         |
| Produktion               | Worker, D1, Domain, Secrets und Cron fehlen                    |

Staging-Secrets, nur Namen:

- `CSRF_SECRET`
- `MATOOL_EMAIL`
- `MATOOL_PASSWORD`
- `MATOOL_REAL_RUNS_ENABLED`
- `ZAPIER_SERVICE_TOKEN`

### Letzter beobachteter automatischer Lauf

Cronlauf vom 19.08.2026, 12:00 Uhr:

- Worker-Outcome: `ok`
- Dauer: ungefähr 52,6 Sekunden
- CPU-Zeit: 1.689 ms
- Technischer Status: 13 von 13 Bereichen erfolgreich
- Abgerufen und gespeichert: 1.652 Datensätze
- Neu/geändert: 22/0
- Fachlicher Status: nicht vollständig
- Begrenzungen der aktiven Version: 4 Interessenten-Details und 20 Klassen
- Telemetrie und Berichte: jeweils 0, trotzdem als erfolgreich bewertet

Historie:

- 59 relevante Stundenläufe seit 12.08.2026
- 13 eindeutig erfolgreich, ungefähr 22 Prozent
- 76 Laufzeilen dauerhaft auf `running`
- 74 davon älter als zwei Stunden
- Dashboard meldet trotzdem `healthy`

### Aktueller Datenbestand

`Letzter Abruf` ist die vom Collector gemeldete Menge und kein unabhängiger
MATOOL-Gesamtwert. `D1 gesamt` kann alte oder durch instabile IDs mehrfach
angelegte Datensätze enthalten.

| Datenbereich          | Letzter Abruf | D1 gesamt | Bekannter Befund                                         |
| --------------------- | -------------:| ---------:| -------------------------------------------------------- |
| Interessenten         | 94            | 1.100     | nur 30 fachlich benannte Strukturen; 64 generische `c00` |
| Interessenten-Details | 4             | 20        | aktive Vierer-Begrenzung                                 |
| Klassen               | 20            | 2.595     | aktive 20er-Begrenzung; starke Mehrfach-/Altbestände     |
| Schüler               | 96            | 132       | 66 generische `c00`; keine Schülerdetails                |
| Check-in              | 5             | 43        | kein belastbarer Anwesenheits-/Zeitraumabgleich          |
| Prüfungen             | 626           | 675       | nicht unabhängig gegen MATOOL geprüft                    |
| Artikel               | 75            | 110       | nur 25 benannte Strukturen; keine Artikeldetails         |
| Lager                 | 121           | 789       | hoher Altbestand; keine Löschungssemantik                |
| Newsletter            | 598           | 598       | Anzahl plausibel; Inhalt nicht unabhängig geprüft        |
| Archiv                | 12            | 13        | fehlende Datensätze bleiben gespeichert                  |
| Telemetrie            | 0             | 0         | leerer Abruf gilt als Erfolg                             |
| Berichte              | 0             | 0         | leerer Abruf gilt als Erfolg                             |
| Karte                 | 1             | 1         | Inhalt nicht unabhängig geprüft                          |

### Bereits bestandene Prüfungen

- [x] 224 Worker-/Root-Tests bestanden.

- [x] 19 Zapier-App-Tests bestanden.

- [x] Alle TypeScript-Prüfungen bestanden.

- [x] Worker-, Web- und Zapier-Build bestanden.

- [x] Zapier-App ist lokal strukturell gültig.

- [x] D1 `quick_check` und `foreign_key_check` bestanden.

- [x] Keine Snapshot-, Change- oder Bereichslauf-Orphans gefunden.

- [x] Lokale Zapier-Tests für mehr als 100 Änderungen bestanden.

- [x] Lokale A→B→A-Tests erzeugen drei unterschiedliche Ereignis-IDs.

- [x] Lokale Zapier-Retry-Tests für 429, 5xx und Netzwerkfehler bestanden.

- [x] Ein echter automatischer Staging-Cronlauf nach Tarifupgrade wurde
  
      beobachtet.

### Kapazitäts- und Kostenbasis

- Workers Paid: 10 Millionen Requests und 30 Millionen CPU-ms pro Monat
  enthalten; 10.000 Subrequests pro Worker-Aufruf.
- Stündlicher Cron: maximal 15 Minuten Laufzeit.
- D1 Paid: 25 Milliarden gelesene Zeilen, 50 Millionen geschriebene Zeilen und
  5 GB Speicher pro Monat enthalten.
- Gemessene 24 Stunden, einschließlich Auditabfragen:
  2.104.848 gelesene Zeilen, 24.799 geschriebene Zeilen, 9,79 MB.
- Erwarteter Normalbetrieb: ungefähr 5 USD pro Monat vor Steuer.
- Kosten sind aktuell nicht der Engpass. Der Engpass ist die Laufzeit.
- 1.014 serielle MATOOL-Anfragen benötigen durch den 700-ms-Mindestabstand
  allein etwa 11:50 Minuten und mit beobachteter Netzgeschwindigkeit grob
  21 Minuten.
- Der interne Grenzwert von 2.500 Anfragen würde allein durch die Pausen etwa
  29 Minuten benötigen und passt nicht in einen Cronlauf.
- Zapier-Kosten sind ohne Tarif, Task-Stufe und Pay-per-Task-Einstellung offen.

---

## Offene Entscheidungen und benötigte Angaben

### TODO DEC-01 – Feiertags-Bundesland festlegen

- [x] **Status:** erledigt

- **Priorität:** hoch

- **Entscheidung:** Welches Bundesland gilt für die Feiertage der Schule?

- **Aktueller Stand:** Im Code ist Schleswig-Holstein fest eingestellt. Die
  vorhandenen MATOOL-Daten nennen Rosenheim; daraus wird Bayern vermutet, aber
  nicht ohne Bestätigung übernommen.

- **Benötigt vom Benutzer:** schriftliche Bestätigung des Bundeslands.

- **Aufwand:** 5 Minuten Entscheidung; gegebenenfalls 30–90 Minuten Umsetzung
  und Tests.

- **Abnahme:** Feiertagstest für das bestätigte Bundesland besteht und ein
  Feiertag wird im nächsten geplanten Lauf korrekt übersprungen.

- **Ergebnis:** Bayern wurde am 19.08.2026 verbindlich bestätigt und als
  Feiertagskalender für den Standort Rosenheim umgesetzt. Mariä Himmelfahrt
  gilt in Rosenheim; das Augsburger Friedensfest und der Reformationstag gelten
  dort nicht.

- **Verifikation:** 32/32 gezielte Kalender-/Zeitplantests bestanden;
  Worker- und Test-Typecheck bestanden. Der Zeitplantest überspringt
  Fronleichnam 2026 und plant den nächsten Lauf am folgenden Werktag um
  09:00 Uhr.

- **Amtliche Nachweise:**
  [Bayerisches Feiertagsgesetz Art. 1](https://www.gesetze-bayern.de/Content/Document/BayFTG-1),
  [Bayerisches Innenministerium](https://www.stmi.bayern.de/staat-und-verfassung/feiertage/),
  [Bayerisches Landesamt für Statistik – Mariä Himmelfahrt](https://www.statistik.bayern.de/statistik/gebiet_bevoelkerung/zensus/himmelfahrt/index.php).

- **Neue Todos aus DEC-01:** keine.

### TODO DEC-02 – Produktionsdomain und Mitarbeiterzugriff festlegen

- [x] **Status:** erledigt

- **Priorität:** kritisch

- **Entscheidungen:**
  
  - endgültiger Produktionshostname
  - zugelassene Mitarbeiter beziehungsweise Access-Gruppe
  - soll Staging nach V1 weiter über `workers.dev` erreichbar bleiben?

- **Benötigt vom Benutzer:** Domain und gewünschte Mitarbeiteridentitäten.

- **Aufwand:** 10–20 Minuten Entscheidung.

- **Abnahme:** Werte sind schriftlich in diesem Abschnitt ergänzt und können
  für TODO PROD-01 verwendet werden.

- **Produktionshostname/V1-Adresse:**
  `https://matool-middleware-staging.soft-hill-4630.workers.dev/`

- **Mitarbeitergruppe:** keine. Es wird kein Mitarbeiterlogin und keine
  Cloudflare-Access-Gruppe verwendet.

- **Zugriffsentscheidung:** Die Seite bleibt absichtlich öffentlich. Jeder mit
  der URL darf alle im Hub angezeigten Daten sehen und alle dort angebotenen
  Verwaltungsfunktionen benutzen. MATOOL selbst bleibt weiterhin
  ausschließlich read-only.

- **Staging nach V1:** Die bestehende `workers.dev`-Adresse bleibt nach V1
  erreichbar und ist zugleich die festgelegte V1-Adresse. Eine zweite Domain
  wurde nicht gewünscht.

- **Verifikation:** Am 19.08.2026 anonym im Browser geprüft: Die Startseite
  öffnet ohne Login; die Schaltflächen `Manuellen Abruf starten` und
  `Struktur erkennen` sind sichtbar und aktiviert. Keine Verwaltungsaktion
  wurde bei dieser Prüfung ausgelöst.

- **Auswirkung auf PROD-01:** PROD-01 bleibt offen, muss aber die bestehende
  Staging-Adresse als gewählten betrieblichen V1-Endpunkt behandeln. Die
  Adresse darf nicht ohne eine neue Benutzerentscheidung ersetzt werden.

- **Akzeptiertes Risiko:** Personenbezogene Klartextdaten und
  Verwaltungsfunktionen sind für jeden erreichbar, der die URL kennt. Diese
  Freigabe wurde am 19.08.2026 ausdrücklich vom Benutzer erteilt.

- **Neue Todos aus DEC-02:** REL-00 wegen des fehlgeschlagenen automatischen
  Cloudflare-Git-Deployments.

### TODO DEC-03 – Klartext ohne Anmeldung verbindlich freigeben oder beenden

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Aktuell sind personenbezogene Klartextdaten und ein öffentlicher
  CSRF-/Verwaltungszugang ohne Anmeldung erreichbar.

- **Entscheidung:**
  
  - entweder Mitarbeiterlogin aktivieren,
  - oder exakt festlegen, welche Testdaten/Felder anonym öffentlich sein
    dürfen,
  - oder die öffentliche Klartextdarstellung echter Personendaten ausdrücklich
    schriftlich als Risiko freigeben.

- **Benötigt vom Benutzer:** schriftliche Auswahl und Feldliste.

- **Aufwand:** 15 Minuten Entscheidung; 30–60 Minuten Umsetzung.

- **Abnahme:** Ein anonymer Test zeigt ausschließlich die schriftlich
  freigegebenen Daten und keine unfreigegebene Verwaltungsfunktion.

- **Vorliegende Benutzerangabe vom 19.08.2026:** Alle vorhandenen Datenfelder
  und Hub-Funktionen sollen ohne Login öffentlich verfügbar sein. Diese Angabe
  wird hier festgehalten; DEC-03 wird erst bei seiner eigenen, ausdrücklich
  freigegebenen Bearbeitung abgenommen und abgehakt.

- **Freigabe/Feldliste:** alle im Hub vorhandenen Datenfelder und Funktionen;
  technische Abnahme noch offen.

### TODO DEC-04 – Löschungs- und Inaktivitätsregel festlegen

- [ ] **Status:** offen

- **Priorität:** hoch

- **Entscheidung:** Was soll geschehen, wenn ein bisher bekannter Datensatz in
  MATOOL nicht mehr erscheint?

- **V1-Vorschlag zur Entscheidung:** nicht physisch löschen, sondern mit
  `inactive_at` beziehungsweise `deleted_at` markieren und als Änderung an
  Zapier melden.

- **Benötigt vom Benutzer:** fachliche Bestätigung oder abweichende Regel.

- **Aufwand:** 10 Minuten Entscheidung; Umsetzung in TODO DQ-02.

- **Abnahme:** Regel ist schriftlich festgelegt und besitzt mindestens ein
  Beispiel für aktiv → inaktiv → wieder aktiv.

- **Bestätigte Regel:** _offen_

### TODO DEC-05 – Zapier-Tarif und sicheren V1-Test-Zap bestätigen

- [ ] **Status:** offen

- **Priorität:** hoch

- **Entscheidungen/Angaben:**
  
  - aktueller Zapier-Tarif und Task-Stufe
  - Pay-per-Task ein- oder ausgeschaltet
  - welcher bestehende Test-Zap auf `matool_record_v2` migriert werden soll
  - welches sichere Testziel die Daten empfängt, ohne Personen zu kontaktieren

- **Befund:** Der Zapier-Account wurde verbunden, die Abrechnungsansicht war im
  Audit aber nicht angemeldet erreichbar. Live wurde nur die private App-Version
  `0.0.0` vom 10.08.2026 nachgewiesen; eine aktive v2-Subscription fehlt.

- **Benötigt vom Benutzer:** Tarifangaben und Freigabe des Test-Zaps/-ziels.

- **Aufwand:** 10–20 Minuten Entscheidung.

- **Abnahme:** Tarif/Task-Limit sind dokumentiert und der benannte Test-Zap
  enthält keine Kontakt-, E-Mail- oder Nachrichtenaktion.

- **Bestätigte Angaben:** _offen_

---

## Phase 1 – Lokalen fertigen Stand kontrolliert auf Staging bringen

### TODO SEC-00 – Personenbezogene Ausgabedateien aus GitHub entfernen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Das Repository `KwonRoSportschule/matool-automatisierung` ist
  öffentlich. Commit `f62b651` enthält unter `outputs/` eine Excel-Datei, die
  direkt aus den unmaskierten Live-Bereichen `interessenten` und
  `interessenten_details` erzeugt wurde. Ohne Werte auszugeben wurden darin
  E-Mail- und telefonähnliche Kontaktfelder bestätigt. Die zugehörige
  PNG-Vorschau und der Generator gehören ebenfalls nicht in den öffentlichen
  Quellcode-Verlauf. Ein normaler Lösch-Commit entfernt die Datei nicht aus der
  bereits veröffentlichten Git-Historie.

- **Benutzerentscheidung vom 19.08.2026:** Das Repository soll vorerst
  öffentlich bleiben. Die Sichtbarkeit wird nicht verändert. Die Bereinigung
  der bereits veröffentlichten Historie wurde noch nicht freigegeben.

- **Abhängigkeit:** ausdrückliche Freigabe für eine bereinigende Umschreibung
  der Git-Historie.

- **Arbeitsschritte:**
  
  - [x] Entscheidung dokumentieren, dass das Repository vorerst öffentlich
    
        bleibt und keine Sichtbarkeitsänderung vorgenommen wird.
  
  - [ ] Ausgabedateien lokal außerhalb des Repository-Verlaufs sichern.
  
  - [ ] `outputs/` aus dem aktuellen Git-Stand und der veröffentlichten
    
        Historie entfernen.
  
  - [ ] `outputs/` und vergleichbare personenbezogene Exportdateien dauerhaft
    
        per `.gitignore` ausschließen.
  
  - [ ] GitHub-Historie und frischen Klon auf XLSX-/Bild-/Kontaktdaten prüfen.
  
  - [ ] Danach verifizieren, dass die Cloudflare-GitHub-App weiterhin auf das
    
        bereinigte Repository zugreifen kann.

- **Abnahme:** Im aktuellen GitHub-Baum und in der erreichbaren Historie sind
  keine personenbezogenen MATOOL-Exporte mehr vorhanden; ein neuer Export wird
  nicht von Git erfasst; ein frischer Prüflauf findet keine Kontaktwerte in
  Binärdateien.

- **Aufwand:** 30–90 Minuten nach Freigabe.

- **Nachweis:** _Repository-Sichtbarkeit, bereinigter Commit/History-Stand und
  Binärdatei-Prüfung hier eintragen_

### TODO REL-00 – Automatisches Cloudflare-Git-Deployment korrigieren

- [x] **Status:** erledigt

- **Priorität:** kritisch

- **Befund:** Der Cloudflare-Build vom 19.08.2026 führte ausschließlich
  `npx wrangler deploy` aus. Dadurch wurde weder `dist/client` erzeugt noch
  `--env staging` angegeben. Der Lauf brach vor dem Upload mit
  `dist/client does not exist` ab. Ohne den Abbruch hätte der Befehl die
  oberste Wrangler-Umgebung statt Staging anvisiert.

- **Abhängigkeiten:** keine technische Abhängigkeit; SEC-00 bleibt aufgrund der
  ausdrücklichen Entscheidung für ein öffentliches Repository separat offen.
  REL-00 muss vor REL-01 erledigt werden.

- **Verifizierter GitHub-Stand vom 19.08.2026:**
  
  - [x] Repository ist mit dem korrekten Remote verbunden.
  
  - [x] Lokales `main` und GitHub-`main` standen beim Auslösen des
    
        Nachweis-Builds beide auf Commit `38a916a`.
  
  - [x] Der vorausgehende Code-Stand `f62b651` hatte eine erfolgreiche
    
        GitHub-CI; die REL-00-Änderung betraf anschließend nur dieses
        Todo-Dokument.
  
  - [x] Der vorhandene Cloudflare-Lauf konnte das Repository klonen und die
    
        Abhängigkeiten installieren; die GitHub-Verbindung besteht.
  
  - [x] Commit `38a916a` wurde nach dem Push auf `main` automatisch gebaut und
    
        ohne manuellen Wrangler-Deploy veröffentlicht.

- **Festgelegte Cloudflare-Buildwerte:**
  
  - Repository: `KwonRoSportschule/matool-automatisierung`
  - Produktionsbranch: `main`
  - Stammverzeichnis: `/`
  - Build-Befehl: `pnpm run build:web`
  - Deploy-Befehl: `pnpm exec wrangler deploy --env staging --strict`
  - andere Branches: kein automatisches Deployment
  - überwachte Pfade: alle

- **Arbeitsschritte:**
  
  - [x] Cloudflare-Build auf `pnpm run build:web` und Deployment auf
    
        `pnpm exec wrangler deploy --env staging --strict` festlegen.
  
  - [x] Sicherstellen, dass zuerst der Web-Build `dist/client` erzeugt.
  
  - [x] Sicherstellen, dass Wrangler ausdrücklich `--env staging --strict`
    
        verwendet.
  
  - [x] Einen neuen Cloudflare-Git-Build beobachten, ohne andere Umgebungen
    
        zu verändern.

- **Abnahme:** Der Cloudflare-Git-Build erstellt `dist/client`, nennt Staging
  ausdrücklich als Ziel und endet erfolgreich. Die aktive Staging-Version
  entspricht dem ausgelösten Commit; keine Top-Level-/Produktionsumgebung
  wurde versehentlich veröffentlicht.

- **Aufwand:** 15–30 Minuten.

- **Nachweis:** Cloudflare-Build `7e180f43-1e21-46e2-a3ad-4602bd8da322`
  für GitHub-Commit `38a916a1f91001eb338e2508369e874199e8fa13` endete
  nach 31 Sekunden erfolgreich. Das Protokoll bestätigt den Web-Build, den
  Deploy-Befehl mit `--env staging --strict`, das D1-Binding
  `matool-middleware-staging`, `APP_ENV=staging` und die aktive Worker-Version
  `67f5c688-a249-4b06-901c-8495fb958252`. `/healthz` lieferte anschließend
  `status=ok`; die Startseite lieferte HTTP 200 und `text/html`.

- **Betriebsregel:** GitHub-`main` ist die einzige Deploymentquelle. Keine
  direkten Wrangler-/Dashboard-Deployments. Cloudflare sieht ausschließlich
  gespeicherte und nach erfolgreicher Prüfung zu `main` gepushte Commits;
  lokale Änderungen werden technisch nicht automatisch übertragen.

### TODO REL-01 – Paid- und Zapier-v2-Code auf Staging bereitstellen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Ziel:** Der bereits lokal entwickelte Paid-/Changefeed-Stand wird
  kontrolliert geprüft, versioniert und ausschließlich auf Staging
  bereitgestellt.

- **Befund:** Live läuft noch die Version vom 11.08.2026 mit 4 Details und
  20 Klassen. Migration `0005_zapier_snapshot_changefeed.sql` fehlt remote.

- **Abhängigkeiten:** keine; Outbound bleibt bei diesem Todo `false`.

- **Arbeitsschritte:**
  
  - [ ] Bestehende uncommittete Änderungen einzeln gegen die freigegebenen
    
        Punkte „Paid-Betrieb“ und „verlustfreies Zapier“ prüfen.
  
  - [ ] Sicherstellen, dass keine Kontaktfunktion aktiviert wird.
  
  - [ ] 243 bestehende Tests, Typechecks, Builds und Repository-Scan erneut
    
        ausführen.
  
  - [ ] Migration 0005 zuerst auf Staging anwenden und Schema prüfen.
  
  - [ ] Neue Worker-Version auf Staging bereitstellen.
  
  - [ ] Aktive Versions-ID und vorherige Rollback-Version notieren.
  
  - [ ] Einen kontrollierten manuellen Read-only-Lauf ausführen.

- **Abnahmekriterien:**
  
  - [ ] Migration 0005 ist nicht mehr ausstehend.
  
  - [ ] Tabelle `zapier_snapshot_subscriptions` und die neuen Changefeed-Felder
    
        existieren.
  
  - [ ] Aktive Worker-Version ist neuer als `e0833ded…`.
  
  - [ ] Interessenten-Details sind nicht mehr auf 4 begrenzt.
  
  - [ ] Klassen sind nicht mehr auf 20 begrenzt.
  
  - [ ] `OUTBOUND_DELIVERY_ENABLED` bleibt `false`.
  
  - [ ] First-Trial-/Kontaktprozess bleibt `disabled`.
  
  - [ ] Rollback wurde nur dokumentiert, nicht unnötig ausgeführt.

- **Aufwand:** 1–2 Stunden.

- **Nachweis:** _Versions-ID, Testresultat, Migrationsergebnis und Lauf-ID hier
  eintragen_

---

## Phase 2 – Laufsteuerung und Stabilität

### TODO RUN-01 – Globalen Lauf-Lock, Fencing und Stale-Recovery bauen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Ziel:** Zu jedem Zeitpunkt darf nur ein MATOOL-Gesamtlauf schreiben.

- **Befund:** Cron, manueller Abruf und doppelter Cron können parallel laufen.
  76 Läufe stehen dauerhaft auf `running`; ältere langsame Läufe können neuere
  Snapshots überschreiben.

- **Abhängigkeiten:** REL-01 abgeschlossen oder sauberer lokaler Stand.

- **Arbeitsschritte:**
  
  - [ ] Lease atomar in D1 erwerben.
  
  - [ ] Eindeutiges Fencing-Token an alle Schreibvorgänge binden.
  
  - [ ] Heartbeat beziehungsweise Ablaufzeit festlegen.
  
  - [ ] Veraltete `running`-Läufe nachvollziehbar auf `aborted`/`failed`
    
        terminalisieren.
  
  - [ ] Manuelle und geplante Läufe benutzen denselben Lock.

- **Abnahmekriterien:**
  
  - [ ] 20 parallele Startversuche erzeugen genau einen Writer.
  
  - [ ] Ein zweiter Start erhält einen klaren `already_running`-Status.
  
  - [ ] Nach simuliertem Worker-Abbruch kann ein neuer Lauf nach Ablauf der
    
        Lease übernehmen.
  
  - [ ] Der alte Writer kann nach Lease-Verlust keine neueren Daten
    
        überschreiben.
  
  - [ ] Keine Testzeile bleibt dauerhaft auf `running`.

- **Aufwand:** 3–6 Stunden.

- **Nachweis:** _noch einzutragen_

### TODO RUN-02 – Abruf in fortsetzbare Pakete unter 12 Minuten teilen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Ziel:** Auch mehr als 500 Details oder Klassen werden vollständig gelesen,
  ohne die 15-Minuten-Crongrenze zu überschreiten.

- **Befund:** 1.014 Anfragen benötigen grob 21 Minuten. Der interne
  2.500er-Grenzwert ist innerhalb eines Cronlaufs technisch nicht nutzbar.

- **Abhängigkeiten:** RUN-01; vollständige Bereichs-IDs aus den DATA-Todos.

- **Arbeitsschritte:**
  
  - [ ] Fortsetzbaren Cursor/Checkpoint pro Datenbereich definieren.
  
  - [ ] Sicheres Paketbudget mit mindestens 20 Prozent Zeitreserve festlegen.
  
  - [ ] Unfertige Pakete eindeutig als `in_progress` statt `succeeded`
    
        speichern.
  
  - [ ] Nächster Lauf setzt exakt beim bestätigten Checkpoint fort.
  
  - [ ] Priorisierung darf keinen Bereich dauerhaft verhungern lassen.

- **Abnahmekriterien:**
  
  - [ ] Test mit mehr als 500 Interessenten-Details ist vollständig.
  - [ ] Test mit mehr als 500 Klassen ist vollständig.
  - [ ] Jeder einzelne Worker-Aufruf bleibt unter 12 Minuten.
  - [ ] Abbruch zwischen zwei Paketen erzeugt weder Verlust noch Duplikat.
  - [ ] Fortschritt ist im Hub sichtbar.

- **Aufwand:** 4–8 Stunden.

- **Nachweis:** _noch einzutragen_

### TODO RUN-03 – MATOOL-Retry, Session-Recovery und Gesamtdeadline ergänzen

- [ ] **Status:** offen

- **Priorität:** hoch

- **Ziel:** Vorübergehende MATOOL-Fehler lassen nicht den gesamten Stundenlauf
  unkontrolliert ausfallen.

- **Befund:** Netzwerkfehler werden einmal wiederholt; HTTP 429/5xx und
  abgelaufene Sessions besitzen keine vollständige Recovery.

- **Abhängigkeiten:** RUN-01 und RUN-02.

- **Arbeitsschritte:**
  
  - [ ] 429 und geeignete 5xx begrenzt wiederholen.
  
  - [ ] `Retry-After`, Backoff und Jitter beachten.
  
  - [ ] Abgelaufene Session sicher erkennen.
  
  - [ ] Genau einen vollständigen Re-Login-Versuch pro betroffenen Bereich
    
        erlauben.
  
  - [ ] Gesamtdeadline vor Cloudflares 15-Minuten-Grenze durchsetzen.
  
  - [ ] Checkpoint vor kontrolliertem Abbruch speichern.

- **Abnahmekriterien:**
  
  - [ ] Tests für 429, 500, 503, Timeout und Netzfehler bestehen.
  - [ ] Session-Ablauf führt zu genau einem Re-Login.
  - [ ] Permanente Fehler enden mit klarem Fehlercode und ohne Endlosschleife.
  - [ ] Ein Deadline-Abbruch bleibt fortsetzbar und nicht dauerhaft `running`.

- **Aufwand:** 3–6 Stunden.

- **Nachweis:** _noch einzutragen_

---

## Phase 3 – MATOOL-Datenbereiche vollständig herstellen

### Gemeinsame Abnahme für alle DATA-Todos

Für jeden Datenbereich wird dieselbe Abgleichstabelle ausgefüllt:

| Prüfung                              | Wert/Nachweis           |
| ------------------------------------ | ----------------------- |
| unabhängige Anzahl in MATOOL         | _offen_                 |
| Anzahl des vollständigen Abrufs      | _offen_                 |
| Anzahl aktueller D1-Datensätze       | _offen_                 |
| stabile MATOOL-ID vorhanden          | _offen_                 |
| Pagination vollständig               | _offen_                 |
| wichtige Felder stichprobenartig 1:1 | _offen_                 |
| Detaildaten vollständig              | _offen_                 |
| Beziehungen geprüft                  | _offen/nicht anwendbar_ |
| leerer/kleiner Abruf korrekt erkannt | _offen_                 |
| Ergebnis                             | _offen_                 |

### TODO DATA-01 – Interessenten und alle Interessenten-Details

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Liste enthält gemischte generische Zeilen; live werden nur vier
  Details pro Lauf gelesen.

- **Benutzerbeobachtung vom 19.08.2026:** MATOOL zeigt sichtbar mehr aktuelle
  Interessenten als der Hub. Eine unabhängige Zählung mit identischen Filtern
  steht noch aus.

- **Benötigte Daten:** vollständiger read-only HAR/HTML, falls die vorhandene
  Aufnahme nicht alle Listen-/Paginationfälle enthält; unabhängige
  MATOOL-Anzahl.

- **Pflichtfelder:** Datum, Anrede, Vorname, Nachname, Straße, PLZ, Ort,
  Telefon, Handy, E-Mail, Quelle, Kontakt, Kontaktart, Schule, Leistung,
  Probetraining 1/2 mit Datum/Zeit/Klasse, Status, Anmerkung und Werbequelle.

- **Arbeitsschritte:**
  
  - [ ] Liste und interne stabile ID vollständig lesen.
  - [ ] Alle Detaildatensätze über den belegten read-only-Endpunkt lesen.
  - [ ] Pagination und mehr als 100/500 Datensätze testen.
  - [ ] Alle Screenshot-/HAR-Felder eindeutig zuordnen.
  - [ ] Mit identischen Filtern für Standort, Status und Suche die sichtbare
    
        MATOOL-Gesamtzahl erfassen und mit vollständigem Abruf sowie aktivem
        D1-Bestand abgleichen; jede Abweichung bis auf stabile MATOOL-ID-Ebene
        erklären und beheben.

- **Abnahme:** Gemeinsame DATA-Abgleichtabelle vollständig bestanden;
  Lillis vorhandener Testdatensatz enthält unter anderem die erwartete E-Mail
  und Telefonnummer, ohne diese Werte in Logs auszugeben. Zusätzlich stimmen
  sichtbarer MATOOL-Bestand, vollständiger Abruf und aktiver D1-Bestand bei
  identischen Filtern 1:1 überein; ein zweiter unveränderter Vollabruf erzeugt
  weder fehlende noch doppelte Interessenten.

- **Aufwand:** 4–8 Stunden nach Vorliegen aller Aufnahmen.

- **Nachweis:** _noch einzutragen_

### TODO DATA-02 – Klassen, Kurse und Stunden

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Live werden 20 Klassen gelesen; D1 enthält 2.595 Zeilen. Frühere
  Beobachtung nannte ungefähr 43 Klassen, muss aber unabhängig bestätigt
  werden. Pagination führt derzeit zu einem Fehler. Die `schuelerliste` aus den
  Klassendaten wird verworfen.

- **Benötigte Daten:** aktueller Klassen-HAR und unabhängige MATOOL-Anzahl.

- **Arbeitsschritte:**
  
  - [ ] Alle Klassenseiten/-griffe vollständig lesen.
  
  - [ ] Klassen-, Kurs- und Stundenfelder festlegen.
  
  - [ ] Stabile Klassen-ID gegen MATOOL prüfen.
  
  - [ ] Pagination statt Abbruch unterstützen.
  
  - [ ] Schülerlistenbeziehung entweder speichern oder begründet einem anderen
    
        Bereich zuordnen.

- **Abnahme:** Alle aktuellen Klassen genau einmal in D1; keine 20er-Rotation,
  keine neuen Scheinklassen bei unverändertem MATOOL-Bestand.

- **Aufwand:** 4–8 Stunden.

- **Nachweis:** _noch einzutragen_

### TODO DATA-03 – Schüler/Mitglieder und Schülerdetails

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Nur eine generische Schülerliste wird gelesen; 66 von 96 Zeilen
  besitzen nur generische Felder. Der HAR-belegte Endpunkt
  `/json/schueler_daten.php` wird nicht verwendet.

- **Benutzerbeobachtung vom 19.08.2026:** MATOOL zeigt sichtbar mehr aktuelle
  Mitglieder als der Hub. Eine unabhängige Zählung mit identischen Filtern
  steht noch aus.

- **Benötigte Daten:** Benutzer stellt eine read-only HAR-Aufnahme bereit, in
  der ein Schüler geöffnet und seine Detaildaten geladen werden.

- **Arbeitsschritte:**
  
  - [ ] Vollständige Schülerliste und Pagination lesen.
  - [ ] Schülerdetail-Endpunkt und alle freigegebenen Felder abbilden.
  - [ ] Stabile Schüler-ID speichern.
  - [ ] Beziehung Schüler → Klasse/Kurs prüfen und speichern.
  - [ ] Mit identischen Filtern für Standort, Status und Suche die sichtbare
    
        MATOOL-Gesamtzahl erfassen und mit vollständigem Abruf sowie aktivem
        D1-Bestand abgleichen; jede Abweichung bis auf stabile MATOOL-ID-Ebene
        erklären und beheben.

- **Abnahme:** Gemeinsame DATA-Abgleichtabelle bestanden; keine generischen
  `c00`-Ersatzdatensätze für fachlich bekannte Schüler. Zusätzlich stimmen
  sichtbarer MATOOL-Bestand, vollständiger Abruf und aktiver D1-Bestand bei
  identischen Filtern 1:1 überein; ein zweiter unveränderter Vollabruf erzeugt
  weder fehlende noch doppelte Mitglieder.

- **Aufwand:** 1 Arbeitstag nach vollständigem HAR.

- **Nachweis:** _noch einzutragen_

### TODO DATA-04 – Check-in und Anwesenheiten

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Aktuell nur generischer Einseitenabruf; Zeitraum, vollständige
  Anwesenheit und Beziehungen sind nicht belegt.

- **Benötigte Daten:** read-only HAR mit Zeitraumwechsel, Liste und einem
  geöffneten Anwesenheits-/Check-in-Datensatz.

- **Arbeitsschritte:**
  
  - [ ] Zeitraum/Pagination vollständig lesen.
  - [ ] stabile IDs und Zeitstempel definieren.
  - [ ] Schüler-, Klassen- und Stundenbeziehungen zuordnen.

- **Abnahme:** Für einen bestätigten Zeitraum stimmen MATOOL-Anzahl, D1-Anzahl
  und Stichproben 1:1 überein.

- **Aufwand:** 4–8 Stunden nach HAR.

- **Nachweis:** _noch einzutragen_

### TODO DATA-05 – Artikel, Artikeldetails und Lager

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Artikel werden nur als generische Liste gelesen; der HAR-belegte
  Endpunkt `/json/artikel_daten.php` fehlt. Lager besitzt einen starken
  historischen Altbestand.

- **Benötigte Daten:** read-only HAR mit geöffnetem Artikel und relevanter
  Lageransicht.

- **Arbeitsschritte:**
  
  - [ ] vollständige Artikelliste/Pagination lesen.
  - [ ] Artikeldetails abbilden.
  - [ ] Artikel-/Lager-ID und Beziehung prüfen.
  - [ ] Bestände, Status und Zeitstempel verifizieren.

- **Abnahme:** Gemeinsame DATA-Abgleichtabelle für Artikel und Lager jeweils
  bestanden.

- **Aufwand:** 1 Arbeitstag nach HAR.

- **Nachweis:** _noch einzutragen_

### TODO DATA-06 – Prüfungen, Newsletter, Archiv und Karte

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Mengen werden gelesen, aber nur aus generischen Einseiten-HTML-
  Tabellen und ohne unabhängigen MATOOL-Abgleich.

- **Benötigte Daten:** unabhängige Quellmengen und HARs, falls Pagination oder
  Detailansichten vorhanden sind.

- **Arbeitsschritte:**
  
  - [ ] pro Bereich eindeutige Bereichsmarker und stabile IDs festlegen.
  - [ ] Pagination prüfen und implementieren.
  - [ ] wichtige Felder fachlich benennen statt `c00`.
  - [ ] Archiv-/Inaktivitätssemantik mit DEC-04 abstimmen.

- **Abnahme:** Gemeinsame DATA-Abgleichtabelle für alle vier Bereiche
  bestanden.

- **Aufwand:** 1–2 Arbeitstage abhängig von HARs.

- **Nachweis:** _noch einzutragen_

### TODO DATA-07 – Telemetrie und Berichte

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Beide Bereiche liefern 0 Datensätze und werden trotzdem als
  erfolgreich gespeichert. Die in der HAR-Dokumentation erkannten Endpunkte
  werden nicht fachlich ausgewertet.

- **Benötigte Daten:** read-only HARs mit sichtbaren Telemetrie-Daten und einem
  tatsächlich erzeugten/angezeigten Bericht. Keine schreibende oder
  kostenpflichtige Aktion ohne Benutzerfreigabe auslösen.

- **Arbeitsschritte:**
  
  - [ ] klären, welche Telemetrie-/Berichtsdaten als strukturierte V1-Daten
    
        verfügbar sind.
  
  - [ ] read-only Endpunkte und Pagination implementieren.
  
  - [ ] echten leeren Bestand von Fehler-/Loginseite unterscheiden.

- **Abnahme:** Entweder strukturierte Daten stimmen 1:1 mit MATOOL überein oder
  der Bereich wird mit belegter Begründung ausdrücklich aus dem V1-Umfang
  entfernt. 0 darf nicht ohne Nachweis als Erfolg gelten.

- **Aufwand:** 4–12 Stunden nach HAR und fachlicher Klärung.

- **Nachweis:** _noch einzutragen_

---

## Phase 4 – Datenqualität und Bestandspflege

### TODO DQ-01 – Stabile IDs und vollständiges Feldschema erzwingen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Fehlt eine MATOOL-ID, wird der ganze Payload-Hash zur source ID.
  Jede Feldänderung kann dadurch einen neuen Datensatz anlegen. Es werden
  maximal 64 Zellen und 500 Zeichen pro Wert gespeichert; IBAN-ähnliche Werte
  werden absichtlich geleert.

- **Abhängigkeiten:** DATA-01 bis DATA-07.

- **Arbeitsschritte:**
  
  - [ ] stabile Identität je Entität dokumentieren und erzwingen.
  - [ ] bei fehlender ID Bereich fehlschlagen statt Scheindatensatz anlegen.
  - [ ] Feldgrenzen pro Fachfeld ausdrücklich definieren.
  - [ ] jede Redaction fachlich und datenschutzrechtlich festlegen.
  - [ ] unbekannte Spalten sichtbar als Schemafehler melden.

- **Abnahme:** Feldänderung aktualisiert dieselbe Quell-ID; kein stilles
  Abschneiden; kein unbekanntes `c00` im final abgenommenen Fachschema.

- **Aufwand:** 4–8 Stunden zusätzlich zu den DATA-Todos.

- **Nachweis:** _noch einzutragen_

### TODO DQ-02 – Leer-/Schrumpfungsprüfung und Löschungssemantik

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** 0 Datensätze oder ein starker Rückgang werden als Erfolg
  gespeichert; fehlende Datensätze bleiben unbegrenzt aktiv.

- **Abhängigkeiten:** DEC-04 und stabile Quellmengen aus DATA-01 bis DATA-07.

- **Arbeitsschritte:**
  
  - [ ] Bereichsmarker und vollständigen Seitenabschluss verlangen.
  - [ ] erwartete Quellanzahl beziehungsweise letzte gesunde Baseline speichern.
  - [ ] kontrollierte Warn-/Fehlerschwellen je Bereich festlegen.
  - [ ] unerwarteten Rückgang nicht in den aktuellen Bestand übernehmen.
  - [ ] bestätigte Löschungs-/Inaktivitätsregel umsetzen.

- **Abnahme:** Test mit Fehlerseite, leerer Liste und 90-Prozent-Rückgang endet
  fehlgeschlagen und verändert den gesunden Bestand nicht; bestätigte echte
  Löschung wird korrekt markiert und an Zapier gemeldet.

- **Aufwand:** 3–6 Stunden.

- **Nachweis:** _noch einzutragen_

### TODO DQ-03 – Historische Scheindaten kontrolliert bereinigen

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Beispielsweise 2.595 Klassen-Snapshots bei einer viel kleineren
  erwarteten realen Klassenmenge und 1.100 Interessenten-Snapshots bei zuletzt
  94 gelesenen Interessenten.

- **Abhängigkeiten:** DQ-01 und DQ-02 vollständig bestanden; vorher keine
  Bereinigung durchführen.

- **Arbeitsschritte:**
  
  - [ ] Backup/Export und exakte Kandidatenliste erstellen.
  - [ ] echte aktuelle IDs gegen MATOOL verifizieren.
  - [ ] Für Interessenten und Mitglieder getrennt die Mengen `MATOOL sichtbar`,
    
        `vollständiger Abruf`, `D1 aktiv` und `D1 historisch` dokumentieren; nur
        eindeutig verifizierte Alt-/Scheindaten inaktiv markieren.
  - [ ] Alt-/Scheindaten zunächst als inaktiv markieren.
  - [ ] physische Löschung nur nach gesonderter Benutzerfreigabe.

- **Abnahme:** Aktiver D1-Bestand entspricht der unabhängig bestätigten
  MATOOL-Menge; keine verifizierte aktuelle Entität verloren; Rollback möglich.

- **Aufwand:** 2–6 Stunden nach stabiler Datenlogik.

- **Nachweis:** _noch einzutragen_

---

## Phase 5 – Zapier produktiv anbinden

### TODO ZAP-01 – Zapier-v2 bereitstellen und bestehenden Zap migrieren

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Lokal existiert der verlustfreie REST-Hook
  `matool_record_v2`. Live ist Migration 0005 nicht angewendet,
  Outbound ist deaktiviert und bestehende Zaps können noch den Legacy-Poll mit
  maximal 100 Datensätzen verwenden.

- **Abhängigkeiten:** REL-01, RUN-01, DQ-01 und DQ-02.

- **Arbeitsschritte:**
  
  - [ ] aktuelle private Zapier-App-Version bauen, validieren und pushen.
  
  - [ ] sicherstellen, dass Legacy `matool_record` verborgen bleibt.
  
  - [ ] neuen Zap mit `matool_record_v2` verbinden.
  
  - [ ] vor Outbound-Aktivierung D1-Prozessmodus
    
        `interessenten_first_trial=disabled` nachweisen.
  
  - [ ] `OUTBOUND_DELIVERY_ENABLED` kontrolliert auf Staging aktivieren.
  
  - [ ] Subscription erstellen und Teständerungen zustellen.

- **Abnahmekriterien:**
  
  - [ ] bestehender Test-Zap verwendet v2, nicht Legacy.
  - [ ] Created, Updated und A→B→A liefern eindeutige Ereignisse.
  - [ ] mehr als 100 Änderungen gehen nicht verloren.
  - [ ] keine Kontakt-, E-Mail- oder Nachrichtenaktion wird ausgelöst.
  - [ ] Zapier erhält alle freigegebenen Interessenten-Detailfelder.

- **Aufwand:** 1–2 Stunden nach den Abhängigkeiten.

- **Nachweis:** _Zapier-App-Version, Zap-ID, Subscription-ID und Testlauf ohne
  personenbezogene Werte eintragen_

### TODO ZAP-02 – Zustellungsfehler und Backlog dauerhaft beherrschen

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Die Zustellung verarbeitet maximal 50 Ereignisse/20 Sekunden pro
  Drain. Permanente 400/401/403-Fehler werden immer wieder versucht und können
  die betroffene Subscription dauerhaft blockieren. Der Drain hängt am Ende
  eines MATOOL-Laufs.

- **Abhängigkeiten:** ZAP-01.

- **Arbeitsschritte:**
  
  - [ ] maximale Versuche und permanenten Fehlerzustand definieren.
  
  - [ ] defektes Ereignis oder defekte Subscription isolieren.
  
  - [ ] unabhängigen, sicheren Backlog-Drain im bestehenden Worker-Scope
    
        festlegen.
  
  - [ ] Backloggröße, ältestes Ereignis und letzten Fehler anzeigen.
  
  - [ ] At-least-once-Verhalten und Zapier-Deduplizierung dokumentieren.

- **Abnahme:** 205 Ereignisse werden 100/100/5 oder gleichwertig vollständig
  abgebaut; 429/5xx werden erneut versucht; permanentes 400 blockiert keine
  andere Subscription; verlorene 2xx-Antwort erzeugt keine doppelte Fachaktion.

- **Aufwand:** 2–4 Stunden.

- **Nachweis:** _noch einzutragen_

---

## Phase 6 – Hub-Status und Zugriff korrekt machen

### TODO UI-01 – Dashboard darf unvollständigen Betrieb nicht als gesund melden

- [ ] **Status:** offen

- **Priorität:** hoch

- **Befund:** Dashboard meldet `healthy`, obwohl 76 Läufe hängen und Details,
  Klassen, Telemetrie sowie Berichte unvollständig sind.

- **Abhängigkeiten:** RUN-01, DQ-02 und ZAP-02 liefern Statusgrundlagen.

- **Arbeitsschritte:**
  
  - [ ] Gesamtstatus aus MATOOL-, D1-, Cron- und Zapierstatus ableiten.
  
  - [ ] Stale-Läufe und letzte vollständige Synchronisation anzeigen.
  
  - [ ] pro Bereich letzte Quellmenge, gespeicherte Menge und
    
        Vollständigkeitsstatus anzeigen.
  
  - [ ] Zapier-Backlog und letzten Zustellungsfehler anzeigen.
  
  - [ ] technisches `succeeded` von fachlich `complete` trennen.

- **Abnahme:** Der heutige Ausgangsstand 4/20/0/0 plus 76 Stale-Läufe führt
  reproduzierbar zu `critical`, nicht `healthy`. Ein vollständig bestandener
  Lauf wechselt anschließend nachvollziehbar auf gesund.

- **Aufwand:** 2–4 Stunden.

- **Nachweis:** _noch einzutragen_

### TODO SEC-01 – Entscheidung DEC-03 technisch durchsetzen

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Ziel:** Datenbank und Verwaltungsfunktionen sind nur im ausdrücklich
  freigegebenen Umfang erreichbar.

- **Abhängigkeiten:** DEC-02 und DEC-03.

- **Arbeitsschritte:**
  
  - [ ] Mitarbeiterzugriff/öffentliche Leserechte gemäß Entscheidung trennen.
  - [ ] Verwaltungs-POSTs niemals allein durch öffentliche Identität erlauben.
  - [ ] serverseitige Maskierung für nicht freigegebene Felder erzwingen.
  - [ ] Zapier-Service-Token weiterhin getrennt schützen.

- **Abnahme:** anonyme, Mitarbeiter- und Zapier-Testmatrix besteht; Secrets,
  nicht freigegebene PII und Verwaltungsaktionen sind für anonyme Besucher
  nicht erreichbar.

- **Aufwand:** 1–3 Stunden abhängig von der Entscheidung.

- **Nachweis:** _noch einzutragen_

---

## Phase 7 – Produktion und V1-Freigabe

### TODO PROD-01 – Produktionsumgebung provisionieren

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Befund:** Produktions-Worker und Produktions-D1 existieren nicht;
  D1-ID, Access-Werte, Domain, Secrets und Cron sind Platzhalter oder leer.

- **Abhängigkeiten:** DEC-01 bis DEC-03; alle kritischen Code-/Daten-Todos
  bestanden.

- **Arbeitsschritte:**
  
  - [ ] EU-D1-Datenbank anlegen und endgültige ID eintragen.
  - [ ] Migrationen 0001 bis 0005 anwenden.
  - [ ] Produktions-Secrets interaktiv setzen; keine Secret-Werte dokumentieren.
  - [ ] Domain/Route und Mitarbeiterzugriff konfigurieren.
  - [ ] Produktions-Cron konfigurieren.
  - [ ] `OUTBOUND_DELIVERY_ENABLED` zunächst `false` lassen.
  - [ ] Health, Zugriff, D1 und read-only MATOOL-Verbindung prüfen.

- **Abnahme:** Produktionsdomain liefert Health 200; anonymer Zugriff entspricht
  DEC-03; D1-Schema vollständig; Cron sichtbar; noch keine Kontaktaktion.

- **Aufwand:** 1–2 Stunden nach Vorliegen aller Werte.

- **Nachweis:** _Domain, Worker-Version, D1-Name und Migrationsstand eintragen_

### TODO QA-01 – V1-End-to-End-, Fehler- und Belastungsabnahme

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Abhängigkeiten:** alle vorherigen kritischen und hohen Todos.

- **Pflichttests:**
  
  - [ ] vollständiger Cronlauf und manueller Lauf
  - [ ] paralleler manueller/Cron-Start
  - [ ] doppelter Cronstart
  - [ ] Worker-Abbruch und Stale-Recovery
  - [ ] MATOOL 429, 500, 503, Timeout, Netzwerkfehler, Sessionablauf
  - [ ] Pagination und mehr als 500 Details/Klassen
  - [ ] leerer Abruf und starker Mengenrückgang
  - [ ] Abbruch während eines Bereichs-/D1-Schreibvorgangs
  - [ ] Created, Updated, A→B→A, Inaktiv/Löschung
  - [ ] Zapier 429, 5xx, Timeout, verlorene 2xx-Antwort, permanentes 4xx
  - [ ] Backlog mit mindestens 205 Änderungen
  - [ ] anonymer/Mitarbeiter-/Zapier-Zugriff
  - [ ] unabhängiger MATOOL-/D1-Abgleich aller 13 Bereiche
  - [ ] kompletter Arbeitstag mit 11 Stundenläufen

- **Abnahmekriterien:**
  
  - [ ] kein Lauf hängt auf `running`.
  - [ ] kein Datensatz fehlt, wird still gekürzt oder falsch zugeordnet.
  - [ ] kein Lauf überschreitet 12 Minuten.
  - [ ] keine Zapier-Änderung geht verloren.
  - [ ] keine Kontaktaktion wird durch den Hub ausgelöst.
  - [ ] Dashboardstatus stimmt mit den Testergebnissen überein.

- **Aufwand:** 1–2 Arbeitstage inklusive vollständigem Beobachtungstag.

- **Nachweis:** _Abnahmetabelle/Log-IDs hier verlinken_

### TODO REL-02 – V1 versionieren, zu GitHub sichern und freigeben

- [ ] **Status:** offen

- **Priorität:** kritisch

- **Abhängigkeiten:** QA-01 vollständig bestanden.

- **Arbeitsschritte:**
  
  - [ ] Arbeitsbaum auf ausschließlich freigegebene Änderungen prüfen.
  - [ ] Abschluss-Tests und Repository-Scan ausführen.
  - [ ] migrations- und rollbackfähigen Commit erstellen.
  - [ ] Branch/Commit zu GitHub pushen und Freigabe dokumentieren.
  - [ ] Produktionsdeployment mit exakter Version durchführen.
  - [ ] Smoke-Test und erster Produktions-Cronlauf prüfen.
  - [ ] Version als V1 markieren.

- **Abnahme:** GitHub-Commit, Produktionsversion und Rollback-Version sind
  dokumentiert; Smoke-Test und erster Cronlauf bestehen; offene kritische/hohe
  Todos = 0.

- **Aufwand:** 1–2 Stunden plus erster Cronlauf.

- **Nachweis:** _Commit, Version, Deploymentzeit und Lauf-ID eintragen_

---

## Empfohlene Bearbeitungsreihenfolge

1. DEC-01 bis DEC-05
2. SEC-00, danach REL-00 und REL-01
3. RUN-01
4. DATA-01 bis DATA-07, jeweils nur nach Vorliegen der benötigten HARs
5. DQ-01 und DQ-02
6. RUN-02 und RUN-03
7. DQ-03
8. ZAP-01 und ZAP-02
9. UI-01 und SEC-01
10. PROD-01
11. QA-01
12. REL-02

## V1-Fortschritt

Diese Tabelle wird nach jedem freigegebenen Arbeitspunkt aktualisiert.

| Kategorie            | Erledigt | Gesamt | Status                   |
| -------------------- | --------:| ------:| ------------------------ |
| Entscheidungen       | 2        | 5      | in Arbeit                |
| Staging-Release      | 1        | 3      | in Arbeit                |
| Laufstabilität       | 0        | 3      | offen                    |
| MATOOL-Datenbereiche | 0        | 7      | offen                    |
| Datenqualität        | 0        | 3      | offen                    |
| Zapier               | 0        | 2      | offen                    |
| Hub/Zugriff          | 0        | 2      | offen                    |
| Produktion/Freigabe  | 0        | 3      | offen                    |
| **Gesamt**           | **3**    | **28** | **V1 nicht freigegeben** |

## Änderungsverlauf dieses Dokuments

| Datum      | Todo-ID               | Änderung                                                                                     | Ergebnis/Nachweis                                                                                                                     |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 19.08.2026 | BASE                  | V1-Todo-Liste aus vollständigem Audit erstellt                                               | Ausgangsstand dokumentiert                                                                                                            |
| 19.08.2026 | DEC-01                | Feiertagskalender auf Bayern/Rosenheim umgestellt und verifiziert                            | 32/32 Tests und beide Typechecks bestanden                                                                                            |
| 19.08.2026 | DEC-02                | Bestehende öffentliche `workers.dev`-Adresse als dauerhafte V1-Adresse ohne Login festgelegt | Anonymer Seitenaufruf und aktivierte Verwaltungsfunktionen verifiziert; keine Aktion ausgelöst                                        |
| 19.08.2026 | REL-00                | Fehlgeschlagenen Cloudflare-Git-Build als neuen Release-Blocker aufgenommen                  | `dist/client` fehlte und Zielumgebung war nicht angegeben; Umsetzung offen                                                            |
| 19.08.2026 | SEC-00                | Personenbezogene MATOOL-Exportdateien im öffentlichen GitHub-Verlauf gefunden                | Separates Sicherheits-Todo bleibt offen; Repository bleibt auf Benutzerwunsch vorerst öffentlich                                      |
| 19.08.2026 | REL-00                | GitHub-, CI- und Cloudflare-Verbindungsstand geprüft; korrekte Buildwerte festgelegt         | Repository-Verbindung besteht, automatischer erfolgreicher Deploy noch offen                                                          |
| 19.08.2026 | REL-00                | Automatisches GitHub-Deployment nach Staging vollständig verifiziert                         | Build `7e180f43`, Commit `38a916a`, Worker-Version `67f5c688`, Health ok und Startseite 200               |
| 19.08.2026 | DATA-01/DATA-03/DQ-03 | Benutzer meldet weniger Interessenten und Mitglieder im Hub als sichtbar in MATOOL           | Verbindlichen 1:1-Bestandsabgleich und idempotenten Kontrolllauf als offene Pflichtschritte ergänzt; Umsetzung und Verifikation offen |
