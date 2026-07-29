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

Bestätigte Ausgangsbasis:

- Cloudflare Worker mit Static Assets;
- ausschließlich internes Mitarbeiter-Dashboard;
- erster Pilot: Kontaktaufnahme mit Interessenten vor ihrem ersten
  Probetraining;
- keine vorhandene private Zapier-MATOOL-App; sie wird neu gebaut;
- Zapier Professional.

### Aufgaben

- produktives MATOOL-Passwort aus der HAR vorsorglich rotieren;
- bestehende MATOOL-Sessions nach Rotation ungültig machen;
- Vorlauf, Kontaktmedium, Kontaktzeiten und fachliche Statusregeln des ersten
  Probetraining-Piloten bestätigen;
- Consent-, Sperr- und Opt-out-Regeln für die Kontaktaufnahme bestätigen;
- stabile Interessenten-ID und eindeutige Zuordnung des ersten
  Probetrainingstermins als notwendiges Gate festlegen;
- Nutzungsrahmen der automatisierten MATOOL-Zugriffe klären;
- Cloudflare-Account, Domain und spätere Access-Identitäten erfassen;
- Staging, Produktion, D1-EU-Jurisdiktion und Aufbewahrungsregeln vor dem ersten
  Echtdatenlauf festlegen;
- öffentlichen Google-Sheets-/XLSX-Zugriff des Altprozesses absichern oder als
  befristetes Risiko mit Verantwortlichem dokumentieren;
- Schnittstellenrichtung der neuen privaten Zapier-App vor Phase 5 festlegen.

### Ergebnisse

- beantwortete Priorität-0-Punkte aus `docs/open-decisions.md`;
- keine produktiven Secrets in Dateien oder Chat;
- bestätigte technische Ausgangsquelle: lokaler, redigierender Probe-Client;
- freigegebene fachliche Eignungs- und Ausschlussregeln für den Shadow-Betrieb.

### Gate

Reale MATOOL-Zugriffe beginnen erst, wenn der Zugriff intern autorisiert, das
Passwort rotiert und außerhalb des Repositories sicher bereitgestellt ist. Reale
Persistenz beginnt erst nach Umgebungs-, EU- und Aufbewahrungsentscheidung.

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
zapier/
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
- Interessentenliste und Struktur des ersten Probetrainingstermins anonymisiert
  vermessen;
- stabile Interessenten-ID, Termin-, Status- und Kontaktfeldselektoren
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
- Interessentenseite liefert reproduzierbare Struktur;
- stabiler Schlüssel anhand mindestens zweier Abrufe bestätigt;
- keine schreibende MATOOL-Anfrage;
- Messwerte entscheiden Free versus Paid Worker.

### Gate

Ohne stabile Interessenten-ID, eindeutigen ersten Probetrainingstermin und
synthetische Parser-Fixture wird Phase 3 nicht freigegeben.

## Phase 3: Kernlogik und D1

### Aufgaben

- normalisierte Schemas mit Laufzeitvalidierung definieren;
- kanonische Serialisierung und SHA-256-Hashes implementieren;
- D1-Schema für Runs, Records, Events, Outbox, Deliveries und Leases anlegen;
- Lease mit Owner-ID, DB-Zeit, TTL, Heartbeat, owner-geprüfter Freigabe und
  monotonem Fencing-Token implementieren;
- Baseline- und Shadow-Modus implementieren;
- Ereignisschema `prospect_trial_contact_due` implementieren;
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

## Phase 4: Shadow-Betrieb für Interessenten vor dem Probetraining

### Aufgaben

- Interessenten-Collector gegen die bestätigte MATOOL-Struktur implementieren;
- bestätigten Vorlauf und lokale Terminlogik in `Europe/Berlin` aktivieren;
- fachliche Ausschlüsse als explizite Regeln abbilden;
- Absagen, Verschiebungen, fehlende Termine und bereits erfolgte Kontakte
  abbilden;
- reale Staging-D1 mit EU-Jurisdiktion und aktiver Löschregel verwenden;
- geplanten Cron zunächst nur in Staging aktivieren;
- Vergleichsprotokoll für MATOOL und Middleware erstellen.

### Verifikation

- zehn aufeinanderfolgende stabile reale read-only Läufe;
- Kandidatenmenge und stabile Schlüssel pro Lauf manuell bestätigt;
- zweiter unveränderter Lauf erzeugt null neue Ereignisse;
- Fälle vor, genau in und nach dem bestätigten Kontaktfenster sind getestet;
- Absage oder Verschiebung erzeugt keine unzulässige Kontaktaktion;
- ein Interessent wird für denselben ersten Probetrainingstermin höchstens
  einmal freigegeben;
- Sommer-/Winterzeit, Monats-/Jahreswechsel und Schaltjahr bestehen;
- gültiges Null-Ergebnis, Trunkierung, Pagination, Duplikate und ungewöhnlich
  große Ergebnismengen sind unterscheidbar;
- korrigierter Probetrainingstermin erzeugt keine unkontrollierte zweite
  Kundenaktion;
- ein simulierter Parser- oder D1-Fehler erzeugt keine negative Aktion;
- keine Personendaten in Logs oder Build-Artefakten.

### Gate

Schriftliche fachliche Bestätigung der Shadow-Ergebnisse.

## Phase 5: Private Zapier-App und Testzustellung

### Aufgaben

- private Zapier-App für Zapier Professional neu aufbauen;
- authentifizierten Trigger beziehungsweise Ausgabeadapter zur Middleware
  implementieren;
- `prospect_trial_contact_due` als versioniertes Trigger-Ereignis definieren;
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
- Service-Token oder Zapier-Endpunkt steht in keinem Frontend-Bundle oder Log;
- private Zapier-App greift nicht direkt mit MATOOL-Zugangsdaten auf MATOOL zu;
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
- ein fälliger Interessent erzeugt höchstens eine freigegebene Kontaktaktion je
  erstem Probetrainingstermin;
- Aufbewahrungs- und Löschjob funktioniert;
- Lauf- und Fehlerstatus sind für Verantwortliche sichtbar.

### Gate

Erweiterung der Zielgruppe erst nach dokumentierter Pilotabnahme.

## Phase 7: Öffentliche Verlängerungsseite und weitere Collectors

Diese Phase ist optional und erhält pro Funktion eine eigene Freigabe:

- tokenisierte öffentliche Verlängerungsseite;
- Jotform- oder WordPress-Anbindung;
- GLZ-Collector und Verlängerungsprozess;
- Rückkanal `renewed`;
- wöchentliche Nachfassereignisse;
- weitere MATOOL-Collectors;
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
3. `prospect_trial_contact_due`-Ereignisse korrekt, minimal und dedupliziert
   erzeugt werden;
4. Zapier genau eine freigegebene Folgeaktion pro Ereignis ausführt;
5. Adminzugriff, Logs, Secrets, Aufbewahrung und Fehlerwege geprüft sind;
6. Shadow- und Produktionsabnahme dokumentiert sind;
7. kein expliziter Punkt des vereinbarten Pilotumfangs offen bleibt.

