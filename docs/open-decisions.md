# Offene Entscheidungen

Status: zur gemeinsamen Klärung  
Stand: 29. Juli 2026

Keine dieser Entscheidungen erfordert Zugangsdaten im Chat oder Repository.

## Priorität 0: vor realem Connector oder Echtdaten

### OD-000: Cloudflare-Hostingmodell

Der ursprüngliche Wunsch nennt Cloudflare Pages. Der technische Vorschlag
verwendet stattdessen einen Worker mit Static Assets.

Optionen:

1. **Worker mit Static Assets – empfohlen:** ein Deployment für UI, API, Cron,
   D1 und Access-Prüfung.
2. **Pages plus separater Worker:** zwei Deployments, zusätzliche
   Serviceauthentifizierung und getrennte Preview-Konfiguration.

Die Wahl muss bestätigt werden, bevor das Projektgrundgerüst erstellt wird.

### OD-001: Umfang der ersten Webseite

**Empfehlung:** internes, durch Cloudflare Access geschütztes Admin-Dashboard.

Alternativen:

1. nur Admin-Dashboard;
2. Admin-Dashboard plus öffentliche Verlängerungsseite;
3. ausschließlich Backend ohne sichtbare Oberfläche.

Eine öffentliche Seite benötigt Tokenverwaltung, Rechts- und Prozessabnahme,
Missbrauchsschutz und einen deutlich größeren Testumfang.

### OD-002: Quellcode der vorhandenen Zapier-MATOOL-Integration

Zu klären: Ist der Quellcode oder ein Export der privaten Integration mit
„Find Memberships / Upcoming Membership Renewals“ verfügbar?

**Empfehlung:** zuerst diesen Quellcode beschaffen. Er kann Login-, Parser- und
Feldwissen enthalten, das in der HAR fehlt.

Falls nicht verfügbar, wird ein lokaler, redigierender Probe-Client gebaut.

### OD-003: Zustimmung und Nutzungsrahmen für MATOOL-Automation

Zu klären:

- erlaubt der Vertrag beziehungsweise Anbieter automatisierte Zugriffe über den
  eigenen Account;
- gibt es ein Rate-Limit oder eine bevorzugte technische Schnittstelle;
- dürfen Cloudflare-Ausgangsadressen auf MATOOL zugreifen;
- existieren MFA, CAPTCHA oder IP-Freigaben.

**Empfehlung:** vor Produktivbetrieb schriftlich klären. Ein lokaler,
read-only PoC erfolgt nur mit interner Autorisierung und minimaler Frequenz.

### OD-004: Stabile Entitäts- und Vertragsperioden-ID

Zu klären:

- unveränderliche Mitgliedschafts-ID;
- unveränderliche Vertrags- oder Vertragsperioden-ID;
- Verhalten der ID bei Verlängerung und Korrektur des Vertragsendes.

Ohne beide Identitätsebenen wird kein produktiver Collector freigegeben. Name,
E-Mail und veränderliche Datumswerte genügen nicht.

### OD-005: Exakte GLZ-Regeln

Vor dem Shadow-Vergleich sind einzeln zu bestätigen:

- welches MATOOL-Feld „Ende der Grundlaufzeit“ bedeutet;
- Vertragsstart `> 01.01.2026` oder `>= 01.01.2026`;
- ob die Startgrenze dauerhaft bestehen bleibt;
- Wochenend- und Feiertagsverhalten;
- Ausfallnachholung und maximale Lookback-Grenze;
- Definition einer gültigen E-Mail;
- vollständige fachliche Ausschlussliste.

Die allgemeine Bestätigung „GLZ als Pilot“ ersetzt diese Festlegungen nicht.

### OD-006: Echtdatenumgebungen, EU-Jurisdiktion und Aufbewahrung

Vor dem ersten Baseline-Lauf mit Echtdaten:

- eigener Staging-Worker und eigene Staging-D1-Datenbank;
- getrennte Produktionsressourcen und Secrets;
- D1-Jurisdiktion `eu` bereits bei Erstellung;
- Access-Schutz auch für Preview- und `workers.dev`-Adressen;
- Löschfristen für Runs, Records, Events, Deliveries und offene Vorgänge.

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

## Priorität 1: vor Zapier-Test

### OD-008: Zapier-Tarif und Richtung

Benötigte Information: aktueller Zapier-Tarif.

**Empfehlung bei Professional/Team/Enterprise:** Worker sendet deduplizierte
Outbox-Ereignisse an einen Catch Hook.

**Fallback:** signierte Google-Apps-Script-Brücke mit privater Tabelle und
append-only Ereignisblatt.

Zu entscheiden:

- Worker pusht an Zapier;
- Zapier pollt eine Middleware-API;
- Google Sheets vermittelt.

### OD-009: Verbindliche Ziel-Deduplizierung

Der Transport arbeitet mindestens einmal. Verlorener 2xx-Response und Timeout
können deshalb einen Retry auslösen.

Verbindliches Gate:

- Zapier beziehungsweise das Ziel speichert die `event_id` dauerhaft **vor**
  der externen Nebenwirkung und verwirft Wiederholungen; oder
- die Zielaktion ist selbst nachweislich idempotent.

Eine reine Rückbestätigung, Transportannahme oder manuelle Freigabe verhindert
allein keine Doppelaktion. Ohne nachgewiesene Ziel-Deduplizierung wird keine
automatische Kundenaktion aktiviert.

### OD-010: Bestehender Wochenreport

Zu entscheiden:

- unverändert weiterführen, nachdem der öffentliche Export abgesichert wurde;
- durch `follow_up_due`-Ereignisse der Middleware ersetzen;
- während der Migration parallel vergleichen.

## Priorität 2: vor Produktivfreigabe oder Ausbau

### OD-011: Standorte und Sektoren

Zu klären:

- ein gemeinsamer Lauf oder getrennte Läufe je Standort;
- eigene Zugangsdaten je Standort;
- standortabhängige Tarife und Empfänger;
- maximale Kandidatenzahl je Lauf.

### OD-012: Verlängerungsformular

Optionen:

1. Jotform beibehalten, aber nur über einen sicheren Tokenaustausch;
2. eigene öffentliche Cloudflare-Seite;
3. bestehende WordPress-Seite anbinden.

Hierfür sind Datenschutz-, Vertrags- und Prozessprüfung gesondert erforderlich.

### OD-013: Cloudflare-Zugriff und Domain

Benötigt werden später:

- Cloudflare-Konto und gewünschte Domain;
- erlaubte Admin-Identitäten für Cloudflare Access;
- GitHub-Repository-Verknüpfung;
- ausdrücklich getrennte Staging- und Produktions-Builds.

## Empfohlene Antwortreihenfolge

Für den nächsten Implementierungsschnitt reichen zunächst fünf Antworten:

1. Worker mit Static Assets statt klassischem Pages-Projekt akzeptiert?
2. Admin-Dashboard zuerst?
3. GLZ als erster Prozess?
4. Quellcode der privaten MATOOL-Zapier-App verfügbar?
5. aktueller Zapier-Tarif?

Die Detailentscheidungen OD-004 bis OD-007 werden danach vor dem ersten
Echtdatenlauf gemeinsam abgeschlossen.

