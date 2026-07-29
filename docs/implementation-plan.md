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
- Zapier Professional;
- privater Zapier REST Hook mit PII-freiem Umschlag, atomarem Claim und
  abschließender Ergebnis-Aktion; kein Catch Hook und kein Polling.

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
  befristetes Risiko mit Verantwortlichem dokumentieren.

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
- D1-Schema für Process Config, Runs, Collector State, Records, Events, Outbox,
  Deliveries, Leases, Zapier-Subscriptions, Delivery-Token und Event-Claims
  anlegen;
- Lease mit Owner-ID, DB-Zeit, TTL, Heartbeat, owner-geprüfter Freigabe und
  monotonem Fencing-Token implementieren;
- Baseline- und Shadow-Modus implementieren;
- Ereignisschema `prospect.first_trial_contact_due` implementieren;
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
- D1 speichert bei Delivery-Token ausschließlich den Hash und lässt je
  `event_id` höchstens einen Event-Claim zu;
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
- echten REST-Hook-Trigger mit dynamischem Subscribe und Unsubscribe
  implementieren;
- Zapier-Zieladresse auf HTTPS unter `hooks.zapier.com` begrenzen, in D1 als
  Subscription verwalten und aus Frontend sowie Logs fernhalten;
- Ausgabeadapter implementieren, der ausschließlich einen PII-freien,
  zeitgestempelten HMAC-Umschlag mit `event_id`, `event_type`, `delivery_id`
  und einmaligem `delivery_token` sendet;
- pro Versuch nur den Delivery-Token-Hash und eine kurze Ablaufzeit in D1
  speichern;
- Service-API doppelt absichern: Cloudflare-Access-Service-Token am Edge und
  unabhängiger App-Bearer-Token im Worker;
- atomaren Claim-Endpunkt implementieren, der die minimierte Ereignisnutzlast
  genau beim ersten Claim je `event_id` liefert;
- `prospect.first_trial_contact_due` als versioniertes Trigger-Ereignis
  definieren;
- Outbox-Retry mit Backoff und maximaler Versuchszahl ergänzen;
- Ergebnis-Aktion für `succeeded` oder `failed` mit `event_id`, `claim_id` und
  optionalem technischen `failure_code` implementieren;
- unbestätigte Claims nach `review_after` sichtbar und kontrolliert
  aufarbeitbar machen;
- `event_id` beziehungsweise `claim_id` als Idempotenzschlüssel an ein
  unterstützendes Kontaktziel weiterreichen;
- genau ein synthetisches Testereignis freigeben;
- Claim-Deduplizierung und, soweit vom gewählten Ziel unterstützt,
  Ziel-Idempotenz nachweisen;
- Zustell- und Fehlerstatus im Adminbereich anzeigen.

### Verifikation

- Hook-Umschlag und Header enthalten keine Personendaten;
- manipulierte, abgelaufene oder falsch signierte Hook-Umschläge werden
  verworfen;
- Klartext-Delivery-Token stehen weder in D1 noch in Logs;
- ein gültiger Token liefert beim ersten Claim genau ein Ereignis;
- Wiederholungen über denselben oder einen späteren Delivery-Versuch liefern
  für dieselbe `event_id` kein zweites Trigger-Ereignis;
- verlorener Claim-Response führt zu einem sichtbaren unbestätigten Claim,
  nicht zu einer zweiten PII-Ausgabe;
- gleichlautende Ergebnisbestätigung ist idempotent, widersprüchliches Ergebnis
  wird abgewiesen;
- 2xx, verlorener 2xx-Response, 4xx, 5xx und Timeout sind getestet;
- permanenter Fehler wird pausiert und sichtbar;
- Access-Service-Token, App-Bearer-Token, Signierschlüssel oder
  Zapier-Zieladresse stehen in keinem Frontend-Bundle oder Log;
- private App sendet Service-Credentials ausschließlich an den konfigurierten
  Middleware-Origin;
- private Zapier-App greift nicht direkt mit MATOOL-Zugangsdaten auf MATOOL zu;
- produktive Empfänger bleiben deaktiviert.

### Gate

Ein Ereignis und beliebig viele PII-freie Transport-Retrys führen zusammen zu
höchstens einem Claim und genau einer bestätigten ungefährlichen Testaktion.
Für das spätere Kontaktziel ist zusätzlich dessen Retry-/Idempotenzverhalten
nachgewiesen.

## Phase 6: Begrenzter Produktionsstart

### Aufgaben

- Produktions-D1 mit EU-Jurisdiktion erstellen;
- zwei pfadgenaue Cloudflare-Access-Anwendungen mit getrennten Audiences für
  Mitarbeiter und Zapier-Service sowie minimale Serviceberechtigungen
  konfigurieren;
- Cloudflare-Access-Service-Token erstellen und seine Client-Zugangsdaten nur
  in der Zapier-Verbindung hinterlegen;
- getrennte Worker-Runtime-Secrets für App-Bearer-Token, Hook-Signatur und
  MATOOL setzen;
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
3. `prospect.first_trial_contact_due`-Ereignisse korrekt, minimal und
   dedupliziert
   erzeugt werden;
4. der private REST Hook keine Personendaten transportiert, je Ereignis
   höchstens ein Claim entsteht und Zapier genau eine bestätigte freigegebene
   Folgeaktion ausführt;
5. Adminzugriff, Logs, Secrets, Aufbewahrung und Fehlerwege geprüft sind;
6. Shadow- und Produktionsabnahme dokumentiert sind;
7. kein expliziter Punkt des vereinbarten Pilotumfangs offen bleibt.

