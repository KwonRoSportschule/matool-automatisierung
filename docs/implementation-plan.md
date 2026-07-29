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
- vorhandenen Quellcode der privaten MATOOL-Zapier-Integration suchen;
- UI-Umfang, Zapier-Tarif und GLZ-Pilot bestätigen;
- Nutzungsrahmen der automatisierten MATOOL-Zugriffe klären;
- Cloudflare-Account, Domain und spätere Access-Identitäten erfassen;
- Aufbewahrungs- und Ausschlussregeln benennen.

### Ergebnisse

- beantwortete Priorität-0-Punkte aus `docs/open-decisions.md`;
- keine produktiven Secrets in Dateien oder Chat;
- bestätigte technische Ausgangsquelle: Altcode oder lokaler Probe-Client.

### Gate

Reale MATOOL-Zugriffe beginnen erst, wenn der Zugriff intern autorisiert und das
Passwort außerhalb des Repositories sicher bereitgestellt ist.

## Phase 1: Lokales Projektgrundgerüst

### Aufgaben

- TypeScript-Worker mit Static Assets anlegen;
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
- stabile Quell-ID und Feldselektoren nachweisen;
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
- Sessionablauf und erneuter Login getestet;
- GLZ-Seite liefert reproduzierbare Struktur;
- stabiler Schlüssel anhand mindestens zweier Abrufe bestätigt;
- keine schreibende MATOOL-Anfrage;
- Messwerte entscheiden Free versus Paid Worker.

### Gate

Ohne stabilen Schlüssel und synthetische Parser-Fixture wird Phase 3 nicht
freigegeben.

## Phase 3: Kernlogik und D1

### Aufgaben

- normalisierte Schemas mit Laufzeitvalidierung definieren;
- kanonische Serialisierung und SHA-256-Hashes implementieren;
- D1-Schema für Runs, Records, Events, Outbox, Deliveries und Leases anlegen;
- atomaren Lease-Erwerb implementieren;
- Baseline- und Shadow-Modus implementieren;
- Adminansicht für Mengen und technische Zustände anbinden.

### Verifikation

- Migrationen lassen sich auf leerer lokaler D1-Datenbank reproduzieren;
- gleiche Eingabe erzeugt gleichen Schlüssel, Hash und Ereignis-ID;
- Unique Constraints verhindern Dubletten;
- konkurrierende Läufe: genau einer erwirbt den Lease;
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
- geplanten Cron zunächst nur in Staging aktivieren;
- Vergleichsprotokoll für MATOOL und Middleware erstellen.

### Verifikation

- zehn aufeinanderfolgende stabile reale read-only Läufe;
- Kandidatenmenge pro Lauf manuell bestätigt;
- zweiter unveränderter Lauf erzeugt null neue Ereignisse;
- Testfälle für 41, 42 und 43 Tage bestehen;
- Sommer-/Winterzeit-Testmatrix besteht;
- ein simulierter Parser- oder D1-Fehler erzeugt keine negative Aktion;
- keine Personendaten in Logs oder Build-Artefakten.

### Gate

Schriftliche fachliche Bestätigung der Shadow-Ergebnisse.

## Phase 5: Zapier-Testzustellung

### Aufgaben

- gewählten Ausgabeadapter implementieren;
- Outbox-Retry mit Backoff und maximaler Versuchszahl ergänzen;
- genau ein synthetisches Testereignis freigeben;
- Deduplizierung im Zap beziehungsweise Zielsystem nachweisen;
- Zustell- und Fehlerstatus im Adminbereich anzeigen.

### Verifikation

- wiederholtes Senden derselben `event_id` erzeugt keine zweite Folgeaktion;
- 2xx, 4xx, 5xx, Timeout und verlorener Response sind getestet;
- permanenter Fehler wird pausiert und sichtbar;
- Zapier-Hook oder Google-Endpunkt steht in keinem Frontend-Bundle oder Log;
- produktive Empfänger bleiben deaktiviert.

### Gate

Ein Ereignis führt exakt zu einer ungefährlichen Testaktion.

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

