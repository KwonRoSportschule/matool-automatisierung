# Zielarchitektur

Status: Vorschlag zur gemeinsamen Freigabe  
Stand: 29. Juli 2026

## 1. Ziel

Die Anwendung bildet eine kontrollierte, versionierte Grenze zwischen MATOOL und
Zapier. Sie übernimmt drei Aufgaben:

1. technisch verifizierte MATOOL-Abrufe;
2. Validierung, Normalisierung und Änderungserkennung;
3. sichere Bereitstellung deduplizierter fachlicher Ereignisse.

Die Webseite ist zunächst ein internes Admin- und Statuswerkzeug. Eine
öffentliche Vertragsverlängerungsseite ist eine getrennt freizugebende
Ausbaustufe.

## 2. Systemübersicht

```mermaid
flowchart LR
    A["Admin-Browser"] -->|Cloudflare Access| W["Worker + Static Assets"]
    C["Cron Trigger"] --> W
    W --> S["Sync-Orchestrator"]
    S --> M["MATOOL-Client<br/>fetch + CookieJar"]
    M --> H["core.matool.de"]
    S <--> D[("D1 EU")]
    S --> O["Ausgabeadapter"]
    O --> Z["Zapier Catch Hook<br/>bei geeignetem Tarif"]
    O --> G["Google Sheets<br/>nur als Fallback"]
```

Der Quellcode liegt in GitHub. Cloudflare Workers Builds kann Commits aus dem
Repository bauen und als Version beziehungsweise Deployment veröffentlichen.

## 3. Hostingentscheidung

Empfohlen wird ein Worker mit Static Assets:

- ein gemeinsames Deployment für Webseite, API und Cron;
- direkte Bindings an D1 und Secrets;
- keine Cross-Origin-Kommunikation zwischen Pages und Worker notwendig;
- identische Preview-Version für Frontend und Backend;
- weniger Konfiguration und weniger öffentliche Angriffsfläche.

Falls Cloudflare Pages verbindlich als Produkt gewählt wird, wird das Repository
als Monorepo aufgebaut:

```text
apps/web       Cloudflare Pages
apps/worker    Cloudflare Worker mit Cron und D1
packages/core  gemeinsame Schemas und Fachlogik
```

Diese Alternative besitzt zwei Deployments und benötigt eine explizite
Authentifizierung zwischen Pages und Worker.

## 4. Komponenten

### 4.1 Admin-Webseite

Erster Umfang:

- Systemstatus ohne Personendaten;
- letzte Läufe mit Dauer und Mengen;
- Collector-Status und Shadow-/Produktionsmodus;
- Fehlerkategorien mit redigierten Details;
- manueller Dry Run;
- Ereigniszähler und Zustellstatus.

Nicht vorgesehen:

- Anzeige kompletter MATOOL-Profile;
- Bearbeitung von MATOOL-Zugangsdaten im Browser;
- frei formulierbare MATOOL-Requests;
- Download von Roh-HTML oder Fotos.

Cloudflare Access wird nicht nur im Dashboard konfiguriert. Für geschützte
Routen prüft der Worker das `Cf-Access-Jwt-Assertion`-JWT auf Signatur,
Aussteller, Zielgruppe und Ablaufzeit. Static Assets müssen über
`assets.run_worker_first` ebenfalls durch diese Prüfung laufen. Die produktive
`workers.dev`-Adresse wird deaktiviert oder gleichwertig geschützt; Preview-URLs
dürfen die Access-Grenze nicht umgehen.

### 4.2 MATOOL-Client

Der Client verwendet ausschließlich standardkonformes `fetch`:

1. Loginseite laden, falls der PoC dies als erforderlich bestätigt.
2. Cookies aus allen `Set-Cookie`-Antworten in einer laufbezogenen CookieJar
   übernehmen.
3. Formular-Login mit `mail` und `pass`, Redirect manuell prüfen.
4. Authentifizierte Folgeseite abrufen und ein stabiles Loginmerkmal prüfen.
5. Alle Collector-Requests mit derselben CookieJar ausführen.
6. Session am Laufende verwerfen.

Der Client bildet nur notwendige Browserkonventionen nach, beispielsweise
`Origin`, `Referer` und bei XHR `X-Requested-With`. Browserautomation wird erst
erwogen, wenn ein HTTP-only-PoC nachweislich nicht funktioniert.

### 4.3 Collector

Ein Collector definiert:

- Namen und Schemaversion;
- fachlichen Zweck und Feld-Whitelist;
- bestätigte Request-Sequenz;
- erwartete Antwortmerkmale;
- Parser, Pflichtfelder und Vollständigkeitsprüfung;
- stabilen Quellschlüssel;
- Hash- und Ereignisregeln;
- synthetische Fixtures;
- Aufbewahrungs- und Ausschlussregeln.

Collectors laufen innerhalb eines Kontos seriell, weil MATOOL-Endpunkte
Sessionzustand verändern können.

### 4.4 D1

D1 wird bei Erstellung auf `jurisdiction=eu` beschränkt. Vorgesehene Tabellen:

```text
runs
collector_state
records
events
outbox
deliveries
leases
renewal_tokens   erst für eine öffentliche Verlängerungsseite
```

Wesentliche Constraints:

- `UNIQUE(collector, source_key)` auf `records`;
- `UNIQUE(event_id)` auf `events`;
- `UNIQUE(event_id, destination)` auf `deliveries`;
- atomarer Lease-Erwerb über eine bedingte D1-Schreiboperation mit
  `owner_run_id`, datenbankbasierter Ablaufzeit und monotonem `fencing_token`;
- Statusfortschreibung und Outbox-Erzeugung in einer D1-Batch-Transaktion.

Es wird zunächst keine Read Replication aktiviert. Das kleine interne System
benötigt aktuelle, konsistente Daten stärker als globale Leselatenz.

Ein Lease ist nur gültig, wenn der bedingte Erwerb genau eine Zeile ändert.
Verlängerung und Freigabe prüfen den Owner. Jeder Record-, Event- und
Outbox-Schreibpfad prüft zusätzlich den aktuellen Fencing-Token, damit ein
abgelaufener alter Lauf nach Start eines neuen Laufs nicht mehr fortschreiben
kann. Cron, Dry Run und manueller Shadow-Lauf verwenden denselben Lockpfad.

Die EU-Jurisdiktion begrenzt Laufzeit und Persistenz der D1-Datenbank. Sie
regionalisiert weder die globale Worker-Ausführung noch ausgehende Requests an
MATOOL oder Zapier. Diese Datenflüsse bleiben Teil der Datenschutz- und
Auftragsverarbeitungsprüfung.

### 4.5 Ausgabeadapter

Die Fachlogik kennt nur einen neutralen `EventSink`:

```text
deliver(event) -> accepted | retryable_error | permanent_error
```

Geplante Adapter:

1. `ShadowSink`: speichert und zeigt Ereignisse, sendet aber nichts.
2. `ZapierWebhookSink`: sendet an einen geheimen Catch Hook.
3. `GoogleSheetsSink`: Fallback über eine signierte Apps-Script-Web-App.

Der direkte Zapier-Adapter ist vorzuziehen, wenn Tarif und fachliche
Deduplizierung dies erlauben. Google Sheets darf nicht öffentlich per Link
freigegeben werden.

## 5. Zeitsteuerung

Fachliches Fenster:

- Montag bis Freitag;
- volle Stunde;
- 08:00 bis 20:00 Uhr `Europe/Berlin`;
- 13 fachliche Läufe pro Werktag.

Breiter UTC-Cron:

```text
0 6-19 * * MON-FRI
```

Lokale Prüfung vor Login, Lease und Datenzugriff:

- Sommerzeit: UTC 06:00 bis 18:00 ausführen, UTC 19:00 verwerfen.
- Winterzeit: UTC 07:00 bis 19:00 ausführen, UTC 06:00 verwerfen.
- `minute === 0` als explizite Invariante prüfen.
- als Zeitquelle ausschließlich `controller.scheduledTime` verwenden, damit
  eine verspätete tatsächliche Ausführung das fachliche Fenster nicht verändert.

## 6. Zustands- und Fehlersemantik

```mermaid
stateDiagram-v2
    [*] --> baseline
    baseline --> candidate
    candidate --> excluded
    candidate --> shadow_ready
    shadow_ready --> approved
    approved --> queued
    queued --> transport_accepted
    queued --> retry_wait
    retry_wait --> queued
    retry_wait --> failed
    transport_accepted --> action_confirmed
    action_confirmed --> renewed
    action_confirmed --> follow_up_due
```

Regeln:

- Baseline erzeugt standardmäßig keine ausgehenden Ereignisse.
- `unchanged` ist ein Laufergebnis, kein gespeicherter Ereignisstatus.
- Ein unveränderter Datensatz erzeugt weder neue Version noch neue Zustellung.
- Leere oder stark verkleinerte Antworten sind Fehler, keine Löschung.
- Ein Collector-Fehler verhindert die Zustandsfortschreibung dieses Collectors.
- Retrys verwenden Backoff und eine maximale Versuchszahl.
- Dauerfehler werden sichtbar pausiert; sie erzeugen keine Endlosschleife.

## 7. Vorgeschlagene API-Grenzen

Alle Antworten enthalten eine Schemaversion.

```text
GET  /healthz                         minimal, keine Bindungs- oder Personendaten
GET  /api/admin/v1/status             Cloudflare Access
GET  /api/admin/v1/runs               Cloudflare Access
GET  /api/admin/v1/events             Cloudflare Access, Werte maskiert
POST /api/admin/v1/sync/dry-run       Cloudflare Access + CSRF-Schutz
POST /api/admin/v1/sync/shadow        Cloudflare Access + CSRF-Schutz
```

Ein Zapier-Service-Endpunkt wird erst festgelegt, wenn Push, Polling oder
Google-Sheets-Fallback entschieden ist.

## 8. Deployment und Umgebungen

Mindestens zwei getrennte Umgebungen:

- `staging`: synthetische Fixtures, später optional ein realer read-only Test;
- `production`: eigene D1-Datenbank, eigene Secrets und explizit aktivierter
  Cron.

Staging und Produktion sind getrennte Worker mit getrennten D1-Datenbanken,
Secrets, Access-Anwendungen und Cron-Konfigurationen. Nicht-produktive Branches
werden ausdrücklich gegen den Staging-Worker gebaut, beispielsweise mit
`wrangler versions upload --env staging`; sie laden keine Version mit
Produktionsbindungen hoch. Ein Preview-Deployment erhält niemals produktive
MATOOL-Secrets oder einen produktiven Zapier-Hook.

## 9. Kapazitätsrisiko

Die aufgezeichneten Schüler- und Interessentenseiten sind ungefähr 0,8 bis
1,0 MB groß. HTML-Parsing kann die CPU-Grenze des Workers Free Plans
überschreiten. Der Machbarkeits-PoC misst:

- CPU- und Wall-Time;
- Antwortgröße;
- MATOOL-Subrequests;
- Kandidatenzahl;
- Parser-Speicher;
- externes Subrequest-Budget einschließlich Login, Redirects und Collector.

Im Free Plan sind höchstens 50 externe Subrequests pro Invocation erlaubt;
jeder Redirect-Schritt zählt mit. Der PoC muss mit Sicherheitsreserve deutlich
darunter bleiben. Benötigt ein fachlich vollständiger Lauf 50 oder mehr
Subrequests, wird er nicht im Free Plan aktiviert; dann werden Paid oder eine
fachlich sichere Aufteilung bewertet. Ein Wechsel erfolgt auf Messwerten, nicht
vorsorglich.

## 10. Referenzen

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/d1/configuration/data-location/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
