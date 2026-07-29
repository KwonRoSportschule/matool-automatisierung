# Offene Entscheidungen

Status: zur gemeinsamen Klärung  
Stand: 29. Juli 2026

Keine dieser Entscheidungen erfordert Zugangsdaten im Chat oder Repository.

## Bestätigte Entscheidungen

### BD-001: Hosting

Die Anwendung wird als Cloudflare Worker mit Static Assets umgesetzt. Ein
getrenntes Cloudflare-Pages-Projekt ist nicht vorgesehen.

### BD-002: Umfang der Webseite

Die Webseite ist ausschließlich ein internes, durch Cloudflare Access
geschütztes Mitarbeiter-Dashboard und dient als Oberfläche der Middleware.

### BD-003: Erster Pilot

Der erste Pilot kontaktiert Interessenten automatisiert vor ihrem ersten
Probetraining. Der GLZ-Verlängerungsprozess ist eine spätere Prozessnotiz und
nicht Teil des aktiven Piloten.

### BD-004: Private Zapier-App

Eine vorhandene private Zapier-MATOOL-App oder deren Quellcode ist nicht
verfügbar. Die benötigte private Zapier-App wird im Projekt neu gebaut und
kommuniziert ausschließlich mit der Middleware, nicht direkt mit
MATOOL-Zugangsdaten.

### BD-005: Zapier-Tarif

Zapier Professional ist vorhanden. Google Sheets ist für den ersten Pilot weder
Transportweg noch Zustandsquelle.

### OD-011: REST-Hook-, Claim- und Ergebnisprotokoll — entschieden

Die neue private Zapier-App verwendet einen echten REST-Hook-Trigger mit
`performSubscribe` und `performUnsubscribe`. Ein manuell kopierter Catch Hook,
Polling und ein direkter Zugriff der Zapier-App auf MATOOL sind ausgeschlossen.

Der gewählte Ablauf:

1. Zapier liefert beim Aktivieren des Zaps eine Hook-Zieladresse; die private
   App registriert sie authentifiziert bei der Middleware.
2. Die Middleware sendet einen HMAC-signierten Umschlag mit
   `schema_version`, `event_id`, `event_type`, `delivery_id` und einem
   kurzlebigen `delivery_token`. Der Umschlag enthält keine Personendaten.
3. Für jeden Zustellversuch wird ein neuer Token erzeugt; D1 speichert nur
   dessen Hash. Ein atomarer Claim legt höchstens einen `event_claims`-Eintrag
   je `event_id` an und gibt nur beim ersten erfolgreichen Claim die minimierte
   Ereignisnutzlast aus.
4. Der letzte Zap-Schritt meldet mit `event_id` und `claim_id` entweder
   `succeeded` oder `failed` zurück. Ein Fehlercode darf nur technische,
   nicht personenbezogene Informationen enthalten.
5. Alle Service-API-Aufrufe benötigen sowohl einen Cloudflare-Access-
   Service-Token als auch einen unabhängigen App-Bearer-Token. Die
   HMAC-Signatur des ausgehenden Hooks ist ein dritter, getrennter Schutz.

Der Transport bleibt mindestens-einmalig: Ein verlorener 2xx-Response oder
Timeout kann einen weiteren PII-freien Umschlag auslösen. Die eindeutige
`event_id` in `event_claims` verhindert jedoch einen zweiten Trigger-Claim.
Ein verlorener Claim-Response wird nicht automatisch erneut mit Personendaten
beantwortet, sondern nach `review_after` kontrolliert aufgearbeitet.

Die Ergebnis-Aktion ist die verbindliche fachliche Rückmeldung, aber keine
rückwirkende Transaktion über eine bereits ausgeführte externe Nebenwirkung.
Wenn das gewählte Kontaktziel eigene Retries oder Idempotenzschlüssel kennt,
muss der Zap `event_id` beziehungsweise `claim_id` dort ebenfalls verwenden.
Dieser Nachweis bleibt ein Produktions-Gate, ist aber keine offene Entscheidung
über die Trigger-Richtung mehr.

Damit gilt ausdrücklich:

```text
claimGuardImplemented = true
targetDedupeVerified  = false
```

Der erste Wert verhindert doppelte Zap-Starts bei Hook-Retrys. Der zweite Wert
bleibt `false`, bis das konkrete E-Mail-, SMS- oder sonstige Kontaktziel auch
bei verlorener Provider-Antwort, eigenem Retry und manueller
Zap-Wiederholung nachweislich keine zweite Nebenwirkung ausführt.

## Priorität 0: vor realem Connector oder Echtdaten

### OD-003: Zustimmung und Nutzungsrahmen für MATOOL-Automation

Zu klären:

- erlaubt der Vertrag beziehungsweise Anbieter automatisierte Zugriffe über den
  eigenen Account;
- gibt es ein Rate-Limit oder eine bevorzugte technische Schnittstelle;
- dürfen Cloudflare-Ausgangsadressen auf MATOOL zugreifen;
- existieren MFA, CAPTCHA oder IP-Freigaben.

**Empfehlung:** vor Produktivbetrieb schriftlich klären. Ein lokaler,
read-only PoC erfolgt nur mit interner Autorisierung und minimaler Frequenz.

### OD-004: Stabile Interessenten- und Termin-ID

Zu klären:

- unveränderliche Interessenten-ID;
- eindeutige Kennung oder stabile Zuordnung des ersten Probetrainingstermins;
- Verhalten der Kennungen bei Terminverschiebung, Absage und erneutem
  Probetraining.

Ohne stabile Identität und kontrollierte Terminzuordnung wird kein produktiver
Collector freigegeben. Name, E-Mail und veränderliche Datumswerte genügen nicht.

### OD-005: Technische Struktur der Interessentenseite

Nachzuweisen sind:

- Request-Sequenz für die Interessentenliste;
- Feld und Format des ersten Probetrainingstermins;
- Status-, Absage- und Archivmerkmale;
- Pagination, Standortwechsel und Vollständigkeitsprüfung;
- stabile Selektoren oder andere strukturierte Feldgrenzen.

### OD-006: Echtdatenumgebungen, EU-Jurisdiktion und Aufbewahrung

Vor dem ersten Baseline-Lauf mit Echtdaten:

- eigener Staging-Worker und eigene Staging-D1-Datenbank;
- getrennte Produktionsressourcen und Secrets;
- D1-Jurisdiktion `eu` bereits bei Erstellung;
- Access-Schutz auch für Preview- und `workers.dev`-Adressen;
- Löschfristen für Runs, Records, Events, Outbox, Deliveries,
  Zapier-Subscriptions, Delivery-Token, Claims und offene Vorgänge.

Die EU-Jurisdiktion betrifft nur D1. Worker-Ausführung und externe Datenflüsse
benötigen weiterhin eine eigene Datenschutzprüfung.

### OD-007: Bekannte Freigaberisiken des Altprozesses

Vor dem neuen PoC:

- MATOOL-Passwort aus der HAR rotieren und Sessions invalidieren;
- Google-Maps-Schlüssel aus MATOOL nicht wiederverwenden und dessen
  Einschränkungen prüfen.

Vor weiterer Nutzung des bestehenden öffentlichen XLSX-Exports:

- Linkfreigabe entfernen oder technisch durch einen authentifizierten Export
  ersetzen; andernfalls das Risiko mit Verantwortlichem und Enddatum
  ausdrücklich dokumentieren.

Die bestehende Reportlogik kann funktional außerhalb des Piloten bleiben. Ihre
öffentliche Datenfreigabe ist deshalb nicht automatisch akzeptiert.

## Priorität 1: vor Shadow-Betrieb

### OD-008: Kontaktzeitpunkt

Zu klären:

- wie lange vor dem ersten Probetraining kontaktiert wird;
- welche Kontaktzeiten und Wochentage zulässig sind;
- wie ausgefallene Läufe nachgeholt werden;
- wie kurzfristig eingetragene oder verschobene Termine behandelt werden.

### OD-009: Kontaktmedium und Inhalt

Zu klären:

- E-Mail, SMS, Messenger oder anderes freigegebenes Medium;
- benötigte Personalisierungsfelder;
- verantwortlicher Zap und Zielsystem;
- freigegebener Text, Absender und Antwortweg.

### OD-010: Einwilligung und Ausschlüsse

Zu klären:

- erforderliche Einwilligung oder andere Rechtsgrundlage;
- Opt-out-, Sperr- und Bereits-kontaktiert-Merkmale;
- Verhalten bei Absage, Archivierung oder unklarem Status;
- Standorte oder Interessentengruppen ohne automatische Kontaktfreigabe.

## Priorität 3: vor Produktivfreigabe

### OD-012: Standorte und Sektoren

Zu klären:

- ein gemeinsamer Lauf oder getrennte Läufe je Standort;
- eigene Zugangsdaten je Standort;
- standortabhängige Kontaktregeln und Empfänger;
- maximale Kandidatenzahl je Lauf.

### OD-013: Datenaufbewahrung

Fristen festlegen für:

- technische Runs und Fehler;
- aktuelle Interessenten- und Termindatensätze;
- Ereignisversionen;
- erfolgreiche und fehlgeschlagene Zustellungen;
- aktive und deaktivierte Zapier-Subscriptions;
- abgelaufene Delivery-Token und unbestätigte Claims;
- erfolgreiche Kontakte und technische Ausschlüsse.

### OD-014: Cloudflare-Zugriff und Domain

Benötigt werden später:

- Cloudflare-Konto und gewünschte Domain;
- erlaubte Mitarbeiteridentitäten für Cloudflare Access;
- getrennte Access-Anwendungen und Audience-Werte für Mitarbeiterzugriff und
  `/api/zapier/v1/*`;
- GitHub-Repository-Verknüpfung;
- endgültige HTTPS-Origin zum Festsetzen von
  `MATOOL_MIDDLEWARE_ORIGIN` in der privaten Zapier-App;
- ausdrücklich getrennte Staging- und Produktions-Builds.

## Spätere Ausbaustufen

### OD-015: GLZ-Prozess

Die Verlängerung nach GLZ bleibt als spätere Prozessnotiz erhalten. Vor ihrer
Aktivierung werden Identitäts-, Datums-, Lookback-, Ausschluss- und
Zustellregeln separat freigegeben.

### OD-016: Verlängerungsformular

Optionen:

1. Jotform beibehalten, aber nur über einen sicheren Tokenaustausch;
2. eigene öffentliche Cloudflare-Seite;
3. bestehende WordPress-Seite anbinden.

Hierfür sind Datenschutz-, Vertrags- und Prozessprüfung gesondert erforderlich.

## Nächste fachliche Antworten

Für den nächsten Implementierungsschnitt werden zuerst benötigt:

1. Wie lange vor dem ersten Probetraining soll die Kontaktaufnahme erfolgen?
2. Über welches Kontaktmedium und mit welchem freigegebenen Inhalt?
3. Welche Status-, Absage-, Archiv- und Bereits-kontaktiert-Regeln gelten?
4. Welche Einwilligungs-, Sperr- und Opt-out-Regeln müssen geprüft werden?
