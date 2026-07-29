# Umsetzungs- und Abnahmeplan

Status: Entwurf zur gemeinsamen Freigabe  
Stand: 29. Juli 2026

## Leitprinzip

Jede Phase endet mit überprüfbarer Evidenz. Ein grüner Unit-Test ersetzt nicht
den Nachweis am tatsächlichen System; ein erfolgreicher Live-Abruf ersetzt
umgekehrt keine Fehler-, Datenschutz- und Deduplizierungstests.

Produktive Kontakt- oder Vertragsaktionen bleiben gesperrt, bis alle
vorgelagerten Gates bestanden und fachlich bestätigt sind.

## Phase 0: Entscheidungen und Sicherheitsvorbereitung

### Aufgaben

- produktives MATOOL-Passwort aus der HAR vorsorglich rotieren;
- bestehende MATOOL-Sessions nach Rotation ungültig machen;
- vorhandenen Quellcode der privaten MATOOL-Zapier-Integration suchen;
- Cloudflare-Hostingmodell und UI-Umfang bestätigen;
- GLZ-Pilot und seine exakten Datums-, Lookback- und Ausschlussregeln
  bestätigen;
- stabile Mitgliedschafts- und Vertragsperioden-ID als notwendiges Gate
  festlegen;
- Nutzungsrahmen der automatisierten MATOOL-Zugriffe klären;
- Cloudflare-Account, Domain und spätere Access-Identitäten erfassen;
- Staging, Produktion, D1-EU-Jurisdiktion und Aufbewahrungsregeln vor dem ersten
  Echtdatenlauf festlegen;
- öffentlichen Google-Sheets-/XLSX-Zugriff des Altprozesses absichern oder als
  befristetes Risiko mit Verantwortlichem dokumentieren;
- Zapier-Tarif spätestens vor Phase 5 erfassen.

### Ergebnisse

- beantwortete Priorität-0-Punkte aus `docs/open-decisions.md`;
- keine produktiven Secrets in Dateien oder Chat;
- bestätigte technische Ausgangsquelle: Altcode oder lokaler Probe-Client.

### Gate

Reale MATOOL-Zugriffe beginnen erst, wenn der Zugriff intern autorisiert, das
Passwort rotiert und außerhalb des Repositories sicher bereitgestellt ist. Reale
Persistenz beginnt erst nach Umgebungs-, EU- und Aufbewahrungsentscheidung.

## Phase 1: Lokales Projektgrundgerüst

### Aufgaben

- nach Annahme von ADR 0001 einen TypeScript-Worker mit Static Assets anlegen;
  bei Wahl von Pages stattdessen das dokumentierte Monorepo aufbauen;
- Wrangler-Konfiguration für `staging` und `production` vorbereiten;
- lokale Testumgebung und Workers-kompatible Tests einrichten;
- API-Routing, Fehlerformat und Log-Redaktion implementieren;
- statisches Admin-Shell ohne Personendaten erstellen;
- D1-Migrationen zunächst lokal definieren.

### Ergebnisse

```text
src/
  worker/
  core/
  matool/
  collectors/
  sinks/
web/
migrations/
test/
fixtures/synthetic/
```

### Verifikation

- Build und Typecheck erfolgreich;
- Unit- und Worker-Integrationstests erfolgreich;
- `/healthz` liefert nur minimale Statusdaten;
- unbekannte Routen und Methoden liefern definierte Fehler;
- Secret- und PII-Scanner finden keine verbotenen Werte;
- statische Webseite und API laufen gemeinsam in `wrangler dev`.

### Gate

Noch keine externe Cloudflare-Ressource und kein produktiver MATOOL-Abruf.

## Phase 2: Read-only MATOOL-Machbarkeits-PoC

### Aufgaben

- laufbezogene CookieJar implementieren;
- optionalen initialen GET und Login-POST testen;
- Redirects manuell behandeln;
- Login durch eine authentifizierte Folgeseite verifizieren;
- GLZ-relevante Listenstruktur anonymisiert vermessen;
- stabile Mitgliedschafts- und Vertragsperioden-ID sowie Feldselektoren
  nachweisen;
- Antwortgröße, CPU-Zeit, Wall-Time und Subrequests messen.

### Protokollierte Werte

Erlaubt:

- Run-ID;
- HTTP-Status;
- Redirectpfad ohne Querywerte;
- Cookie-Namen ohne Werte;
- Antwortgröße;
- Anzahl Tabellen, Zeilen und Pflichtfelder;
- Parserdauer und strukturierte Fehlerklasse.

Verboten:

- Cookies, Passwort, E-Mail-Adressen oder Namen;
- Roh-HTML;
- Fotos;
- vollständige Request- oder Response-Bodies.

### Verifikation

- erfolgreicher und fehlgeschlagener Login unterscheidbar;
- Sessionablauf und höchstens eine begrenzte, erkannte Re-Authentifizierung
  getestet;
- GLZ-Seite liefert reproduzierbare Struktur;
- stabiler Schlüssel anhand mindestens zweier Abrufe bestätigt;
- keine schreibende MATOOL-Anfrage;
- Messwerte entscheiden Free versus Paid Worker.

### Gate

Ohne stabile Mitgliedschafts- und Vertragsperioden-ID sowie synthetische
Parser-Fixture wird Phase 3 nicht freigegeben.

## Phase 3: Kernlogik und D1

### Aufgaben

- normalisierte Schemas mit Laufzeitvalidierung definieren;
- kanonische Serialisierung und SHA-256-Hashes implementieren;
- D1-Schema für Runs, Records, Events, Outbox, Deliveries und Leases anlegen;
- Lease mit Owner-ID, DB-Zeit, TTL, Heartbeat, owner-geprüfter Freigabe und
  monotonem Fencing-Token implementieren;
- Baseline- und Shadow-Modus implementieren;
- Adminansicht für Mengen und technische Zustände anbinden.

### Verifikation

- Migrationen lassen sich auf leerer lokaler D1-Datenbank reproduzieren;
- gleiche Eingabe erzeugt gleichen Schlüssel, Hash und Ereignis-ID;
- Unique Constraints verhindern Dubletten;
- konkurrierende Läufe: genau einer erwirbt den Lease;
- ein abgelaufener alter Owner kann nach neuem Lease keine Records, Events oder
  Outbox mehr schreiben;
- fehlgeschlagener Collector aktualisiert keinen erfolgreichen Zustand;
- Baseline erzeugt null Outbox-Einträge;
- Adminansicht zeigt keine unmaskierten Personenwerte.

### Gate

Die gesamte Phase läuft mit synthetischen Fixtures.

## Phase 4: GLZ-Shadow-Betrieb

### Aufgaben

- GLZ-Collector gegen die bestätigte MATOOL-Struktur implementieren;
- Berlin-Stichtagslogik und 42-Tage-Regel aktivieren;
- fachliche Ausschlüsse als explizite Regeln abbilden;
- reale Staging-D1 mit EU-Jurisdiktion und aktiver Löschregel verwenden;
- geplanten Cron zunächst nur in Staging aktivieren;
- Vergleichsprotokoll für MATOOL und Middleware erstellen.

### Verifikation

- zehn aufeinanderfolgende stabile reale read-only Läufe;
- Kandidatenmenge und stabile Schlüssel pro Lauf manuell bestätigt;
- zweiter unveränderter Lauf erzeugt null neue Ereignisse;
- Testfälle für 41, 42 und 43 Tage bestehen;
- Sommer-/Winterzeit, Monats-/Jahreswechsel und Schaltjahr bestehen;
- gültiges Null-Ergebnis, Trunkierung, Pagination, Duplikate und mehr als 500
  Treffer sind unterscheidbar;
- korrigiertes Vertragsende erzeugt keine zweite Kundenaktion;
- ein simulierter Parser- oder D1-Fehler erzeugt keine negative Aktion;
- keine Personendaten in Logs oder Build-Artefakten.

### Gate

Schriftliche fachliche Bestätigung der Shadow-Ergebnisse.

## Phase 5: Zapier-Testzustellung

### Aufgaben

- gewählten Ausgabeadapter implementieren;
- Outbox-Retry mit Backoff und maximaler Versuchszahl ergänzen;
- dauerhafte Ziel-Deduplizierung der `event_id` vor der Nebenwirkung
  implementieren oder eine nachweislich idempotente Zielaktion wählen;
- genau ein synthetisches Testereignis freigeben;
- Deduplizierung im Zap beziehungsweise Zielsystem nachweisen;
- Zustell- und Fehlerstatus im Adminbereich anzeigen.

### Verifikation

- wiederholtes Senden derselben `event_id` erzeugt keine zweite Folgeaktion;
- 2xx, verlorener 2xx-Response, 4xx, 5xx und Timeout sind getestet;
- permanenter Fehler wird pausiert und sichtbar;
- Zapier-Hook oder Google-Endpunkt steht in keinem Frontend-Bundle oder Log;
- produktive Empfänger bleiben deaktiviert.

### Gate

Ein Ereignis und beliebig viele Transport-Retrys führen zusammen exakt zu einer
ungefährlichen Testaktion.

## Phase 6: Begrenzter Produktionsstart

### Aufgaben

- Produktions-D1 mit EU-Jurisdiktion erstellen;
- Cloudflare Access und minimale Serviceberechtigungen konfigurieren;
- Runtime-Secrets setzen;
- Cron aktivieren;
- kleine, ausdrücklich freigegebene Zielgruppe aktivieren;
- Monitoring und Alarmweg festlegen.

### Verifikation

- Produktionskonfiguration ist von Staging getrennt;
- Rollback auf vorherige Worker-Version getestet;
- Erstimport bleibt aktionsfrei;
- reale Änderung erzeugt genau eine freigegebene Aktion;
- Aufbewahrungs- und Löschjob funktioniert;
- Lauf- und Fehlerstatus sind für Verantwortliche sichtbar.

### Gate

Erweiterung der Zielgruppe erst nach dokumentierter Pilotabnahme.

## Phase 7: Öffentliche Verlängerungsseite und weitere Collectors

Diese Phase ist optional und erhält pro Funktion eine eigene Freigabe:

- tokenisierte öffentliche Verlängerungsseite;
- Jotform- oder WordPress-Anbindung;
- Rückkanal `renewed`;
- wöchentliche Nachfassereignisse;
- Interessenten- und weitere MATOOL-Collectors;
- später eventuell kontrollierte schreibende MATOOL-Aktionen.

Schreibende MATOOL-Aktionen sind kein automatischer Bestandteil des
read-only Piloten. Sie benötigen eigene HAR-/Request-Belege, Idempotenzregeln,
Rollbackstrategie und fachliche Freigabe.

## Verantwortungsgrenzen

### Fachliche beziehungsweise kontobezogene Freigabe

Durch den Projektverantwortlichen:

- Prozess- und Ausschlussregeln;
- externe Konten, Tarife und Berechtigungen;
- produktive Empfänger und Kontakttexte;
- Datenschutz- und Aufbewahrungsentscheidungen;
- Aktivierung von Cron und Kundenaktionen.

### Technische Umsetzung und Evidenz

Durch die Implementierung:

- Quellcode, Tests, Migrationen und Dokumentation;
- Secret-sichere Konfiguration;
- Parser- und Contract-Tests;
- Lauf-, Deduplizierungs- und Ausfalltests;
- Shadow-Vergleich und technische Abnahmebelege.

## Gesamtdefinition von „fertig“

Das Projekt ist erst fertig, wenn:

1. Webseite, Worker, D1 und GitHub-Deployment produktiv verbunden sind;
2. MATOOL read-only zuverlässig und autorisiert abgerufen wird;
3. GLZ-Ereignisse korrekt, minimal und dedupliziert erzeugt werden;
4. Zapier genau eine freigegebene Folgeaktion pro Ereignis ausführt;
5. Adminzugriff, Logs, Secrets, Aufbewahrung und Fehlerwege geprüft sind;
6. Shadow- und Produktionsabnahme dokumentiert sind;
7. kein expliziter Punkt des vereinbarten Pilotumfangs offen bleibt.

