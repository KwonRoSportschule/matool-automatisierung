# Pilotspezifikation: Interessenten vor dem ersten Probetraining

Status: technisches Grundgerüst umgesetzt, fachliche Regeln offen  
Stand: 29. Juli 2026

## 1. Ziel

Der Pilot erkennt in MATOOL angelegte Interessenten mit einem bevorstehenden
ersten Probetraining. Die Middleware erzeugt daraus genau ein versioniertes und
dedupliziertes Ereignis. Zapier übernimmt anschließend die fachlich
freigegebene Kontaktaktion.

Die Middleware:

- liest MATOOL ausschließlich read-only;
- zeigt keine vollständigen Interessentenprofile im Dashboard;
- speichert und überträgt nur freigegebene Felder;
- stellt keine frei adressierbare MATOOL-Proxy-API bereit;
- aktiviert ohne Shadow-Abnahme keine Kundenaktion.

Schreibende MATOOL-Aktionen und der GLZ-Prozess sind nicht Teil dieses Piloten.

## 2. Belastbare HAR-Evidenz

Die HAR ist vertraulich und bleibt außerhalb des Repositories. Die folgende
Tabelle enthält ausschließlich sanitisierte Strukturinformationen.

| Beobachtung | Methode und Pfad | Belastbare Aussage | Grenze |
|---|---|---|---|
| Interessentenansicht | `GET /index.php`, Queryfeld `show` | Eine Ansicht `interessenten` wurde mit HTTP 200 und einer deklarierten Größe von ungefähr 0,8 MB abgerufen. | Der HTML-Body wurde in der HAR nicht gespeichert. Feldnamen, Selektoren und Vollständigkeit sind unbekannt. |
| Auswahl eines Interessenten | `POST /json/session_interessenten_open.php` | Die Formularfelder heißen `interessenten_open` und `todo`; der beobachtete `todo`-Ablauf öffnet einen Datensatz in der laufenden Session. | Die stabile Bedeutung des ID-Werts und mögliche Session-Nebenwirkungen müssen live verifiziert werden. |
| Statistik-Nachabruf | `POST /json/statistik_daten.php` | Nach einer beobachteten Auswahl folgte ein Request mit dem Formularfeld `id`. | Die Antwort darf ohne Feldprüfung nicht als Quelle des ersten Probetrainings interpretiert werden. |
| Pagination-Indiz | geladene Bilder `pagination.png` und `pagination_selected.png` | Die Oberfläche besitzt sichtbare Pagination-Elemente. | In der Aufzeichnung wurde kein belastbarer `page`-, `offset`- oder Cursorparameter nachgewiesen. |
| Browserkonventionen | XHR-Header und Referer | MATOOL verwendet unter anderem `Origin`, `Referer` und bei XHR `X-Requested-With`. | Diese Header beweisen keine stabile fachliche Schnittstelle. |

In der Aufzeichnung wurde kein belastbarer Endpunkt und kein Feldname gefunden,
der ausdrücklich den ersten Probetrainingstermin bezeichnet. Auch ein
maschinenprüfbares Merkmal für Absage, Archivierung, Einwilligung oder bereits
erfolgten Kontakt ist noch nicht belegt.

Die HAR genügt damit für das sichere HTTP-Grundgerüst, aber nicht für einen
produktiven Interessenten-Parser.

## 3. Technischer Probeablauf

Der implementierte Probe-Client führt nach ausdrücklicher Freigabe höchstens
folgende Sequenz aus:

1. `POST /index.php` mit den MATOOL-Loginfeldern;
2. relativen Redirect ausschließlich innerhalb `https://core.matool.de`
   manuell prüfen und als `GET` verfolgen;
3. `GET /index.php?show=interessenten`;
4. Loginseite und Interessentenmarker unterscheiden;
5. nur HTTP-Status, Content-Type, Bodygröße, Cookie-Anzahl und Anzahl
   struktureller Zeilenmarker zurückgeben;
6. laufbezogene Cookies unmittelbar verwerfen.

Die Probe speichert kein Roh-HTML und gibt weder Namen noch E-Mail-Adressen,
Telefonnummern, IDs oder Cookiewerte zurück. Sie ist nur verfügbar, wenn:

- das Passwort aus der HAR rotiert und alte Sessions beendet wurden;
- MATOOL-Secrets ausschließlich lokal beziehungsweise als Cloudflare Secrets
  gesetzt wurden;
- `MATOOL_REAL_RUNS_ENABLED=confirmed-read-only` ausdrücklich gesetzt wurde;
- ein Mitarbeiter über Cloudflare Access beziehungsweise lokal über den
  Loopback-only-Entwicklungsmodus authentifiziert ist;
- CSRF-Token, Origin und JSON-Content-Type gültig sind.

Die Strukturprobe bestätigt noch keine Feldzuordnung. Für diesen Nachweis wird
im nächsten Schnitt ein redigierender Feldinspektor ergänzt, der ausschließlich
Labels, Selektoren, Datentypen und Mengen ausgibt.

## 4. Benötigtes normalisiertes Quellschema

| Feld | Zweck | Status |
|---|---|---|
| `prospect_id` | stabiler Interessentenschlüssel | in MATOOL noch nachzuweisen |
| `trial_appointment_id` | stabile Identität des ersten Probetrainingstermins | in MATOOL noch nachzuweisen |
| `first_trial_starts_at` | fachlicher Termin mit Berliner Zeitzone | Feld und Format offen |
| `prospect_status` | aktiv, abgesagt, archiviert oder anderer Status | Werte und Quelle offen |
| `first_name` | optionale Personalisierung in Zapier | fachliche Freigabe offen |
| `email` | Kontaktweg E-Mail | Kontaktmedium und Validierung offen |
| `phone` | Kontaktweg SMS oder Telefonaufgabe | Kontaktmedium und Validierung offen |
| `location_code` | standortabhängige Regeln und Zap-Routing | MATOOL-Feld offen |
| `contact_permission` | Einwilligung beziehungsweise freigegebene Rechtsgrundlage | Quelle und Regel offen |
| `already_contacted` | Ausschluss einer erneuten Aktion | Quelle und Semantik offen |

Name, E-Mail, Telefonnummer oder Termindatum dürfen keine Ersatzschlüssel sein.
Ohne stabile Interessenten- und Terminidentität bleibt der Collector gesperrt.

## 5. Fachliche Zustände

Die bereits implementierte reine Kernlogik kennt:

| Zustand | Bedeutung |
|---|---|
| `pending` | Der freigegebene Kontaktzeitpunkt ist noch nicht erreicht. |
| `due` | Der Kontaktzeitpunkt liegt im freigegebenen Ausführungsfenster. |
| `stale` | Das Nachholfenster ist abgelaufen oder das Probetraining hat bereits begonnen. |
| `excluded` | Ein für den gewählten Kontaktweg benötigtes Feld fehlt. |

Weitere Ausschlüsse für Status, Absage, Archivierung, Opt-out, Einwilligung oder
bereits erfolgten Kontakt werden erst nach fachlicher Bestätigung ergänzt.

Der technische Ereignistyp lautet:

```text
prospect.first_trial_contact_due
```

Der fachliche Ereignisschlüssel wird aus stabiler Interessenten-ID, stabiler
Termin-ID und Ereignistyp gehasht. Eine reine Terminverschiebung ändert die
Quellrevision, erzeugt für denselben Termin aber keine zweite Ereignis-ID.
Payload- und Schemaversion sind nicht Teil der fachlichen Ereignis-ID.

## 6. Privater Zapier REST Hook

Die private Zapier-App verwendet einen echten REST-Hook-Trigger. Beim
Aktivieren registriert `performSubscribe` die von Zapier erzeugte Zieladresse
bei der Middleware; `performUnsubscribe` deaktiviert diese Subscription. Es
gibt keinen manuell kopierten Catch Hook und kein Polling.

### 6.1 Hook-Umschlag ohne Personendaten

Die Middleware sendet an den registrierten Hook ausschließlich:

```text
schema_version
event_id
event_type
delivery_id
delivery_token
```

Der Umschlag enthält weder Name noch E-Mail-Adresse, Telefonnummer, Termin,
Standort oder andere Fachdaten. Er wird über Zeitstempel und kanonischen Body
mit HMAC-SHA-256 signiert. Pro Outbox-Versuch entsteht ein neuer
kryptografischer Delivery-Token mit kurzer Gültigkeit; der Klartext steht nur
im Hook, D1 speichert ausschließlich seinen SHA-256-Hash. Hook-Zieladresse,
Token und Signatur dürfen nicht in Logs oder im Dashboard erscheinen.

Ein HTTP 2xx auf diesen Umschlag bedeutet ausschließlich
`transport_accepted`, nicht „Interessent kontaktiert“ und auch noch nicht
`action_confirmed`.

Ein Timeout oder ein anderer wiederholbarer Fehler kann trotz fehlender
Transportbestätigung bereits einen Zap ausgelöst haben. Nach dem letzten
Versuch wartet die Middleware deshalb mindestens bis zum Ablauf des
ausgegebenen Delivery-Tokens auf einen Claim. Ein gültiger verspäteter Claim
wird noch angenommen; erst danach wird ohne Claim dauerhaft fehlgeschlagen.
Auch ein späterer permanenter Fehler darf einen noch gültigen Token aus einem
älteren ambigen oder akzeptierten Versuch nicht entwerten. Ein permanenter
Fehler ohne älteren gültigen Token beendet den Vorgang dagegen sofort.

### 6.2 Einmaliger atomarer Claim

Nach erfolgreicher Hook-Prüfung sendet die private App `event_id`,
`delivery_id` und `delivery_token` an
`POST /api/zapier/v1/events/claim`. D1 legt atomar höchstens einen Claim je
`event_id` an. Nur der erste gültige Claim erhält eine `claim_id` und die
minimierte Ereignisnutzlast:

```text
event_id
event_type
claim_id
occurred_at
payload_version
prospect.first_name        nur falls fachlich freigegeben
prospect.email             nur beim freigegebenen Kontaktweg E-Mail
prospect.phone             nur beim dafür freigegebenen Kontaktweg
first_trial.appointment_id
first_trial.starts_at
first_trial.location_code  nur falls benötigt
contact.channel
contact.due_at
```

Wiederholungen liefern `already_claimed` beziehungsweise
`already_confirmed` und starten keinen zweiten Zap. Ein nach erfolgreichem
Claim verlorener Response wird nicht erneut mit Personendaten beantwortet; ein
unbestätigter Claim wird nach `review_after` sichtbar kontrolliert. Damit wird
eine Doppelaktion zugunsten einer gegebenenfalls manuellen Aufarbeitung
vermieden.

Die produktive Claim-Antwort bleibt gesperrt, solange die in Abschnitt 4
aufgeführten MATOOL-Felder und ihre fachliche Freigabe fehlen. Synthetische
Beispieldaten beweisen keine reale Feldzuordnung.

### 6.3 Ergebnis-Aktion und Authentifizierung

Der letzte Zap-Schritt muss die private App-Aktion „Kontakt-Ergebnis melden“
ausführen. Sie sendet:

```text
event_id
claim_id
outcome        succeeded | failed
failure_code   optional, nur technisch und ohne PII
```

Nur ein bestätigtes `succeeded` setzt das Ereignis auf `action_confirmed`.
Dasselbe Ergebnis kann idempotent wiederholt werden; ein widersprüchliches
Ergebnis wird abgewiesen. Die Bestätigung macht eine bereits ausgeführte,
nicht-idempotente Zielaktion nicht rückgängig. Unterstützt das Kontaktziel
einen Idempotenzschlüssel, verwendet der Zap deshalb zusätzlich `event_id`
beziehungsweise `claim_id`.

Der atomare Claim löst damit ausschließlich die Deduplizierung des
REST-Hook-Triggers:

```text
claimGuardImplemented = true
targetDedupeVerified  = false
```

Die Idempotenz der tatsächlichen E-Mail-, SMS- oder sonstigen Kontaktaktion bei
ambiger Provider-Antwort, Zap-Retry oder manueller Wiederholung bleibt ein
separates Produktions-Gate.

Alle privaten App-Aufrufe an die Middleware benötigen gleichzeitig:

- einen Cloudflare-Access-Service-Token über dessen Client-ID und
  Client-Secret für die ausschließlich auf `/api/zapier/v1/*` begrenzte
  Access-Anwendung mit eigener Audience;
- einen unabhängigen App-Bearer-Token im `Authorization`-Header.

Der Webhook-Signierschlüssel ist ein separates Secret und schützt die
entgegengesetzte Richtung von der Middleware zum Zapier REST Hook.

## 7. Baseline, Shadow und Aktivierung

1. **Strukturprobe:** technische HTML-Struktur ohne Speicherung prüfen.
2. **Synthetischer Parser:** ausschließlich künstliche Fixtures verwenden.
3. **Baseline:** reale Schlüssel und minimierte Werte in Staging-D1 erfassen,
   aber null Zapier-Ereignisse erzeugen.
4. **Shadow:** Kandidaten und Ausschlüsse über mindestens zehn vollständige
   Läufe auf Datensatzebene vergleichen.
5. **Synthetischer Zapier-Test:** REST Hook abonnieren, denselben technischen
   Umschlag beziehungsweise dieselbe `event_id` mehrfach zustellen, genau einen
   Claim erhalten und genau eine ungefährliche Ergebnis-Aktion bestätigen.
6. **Begrenzter Pilot:** nur freigegebene Standorte, Zeiten, Kontaktwege und
   Texte aktivieren.

Ein unerwartetes Schema, eine Loginseite mit HTTP 200, unvollständige
Pagination, widersprüchliche Duplikate oder fehlende Pflicht-IDs machen den
gesamten Collector-Lauf ungültig. Sie werden nicht als fachlicher Ausschluss
behandelt und schreiben keinen erfolgreichen Watermark fort.

## 8. Bereits implementierte Abnahmeevidenz

- deterministische Ereignis-ID unabhängig von einer reinen Terminkorrektur;
- andere Termin-ID erzeugt anderes Ereignis;
- pending-, due-, stale- und fehlender-Kontaktweg-Test;
- MATOOL-Host-Allowlist und blockierte Fremd-Redirects;
- laufbezogene CookieJar ohne Cookiewerte im Ergebnis;
- Access-Schutz auch vor statischen Assets;
- CSRF-, Origin- und Content-Type-Prüfung für die Probe;
- D1-Migration in der Worker-Testlaufzeit;
- Zapier-Hook-Allowlist, PII-freier Umschlag, HMAC-Signatur und
  Retry-Klassifizierung;
- private Zapier-App mit REST-Hook-Subscription, Claim-Trigger und
  Ergebnis-Aktion als lokalem technischen Grundgerüst;
- App-Test, dass ein erfolgreicher Claim genau ein Ereignis und ein doppelter
  Claim kein zweites Ereignis ausgibt;
- Weitergabe von Access- und Bearer-Zugangsdaten ausschließlich an den
  konfigurierten Middleware-Origin;
- Repository-Scanner gegen HAR-, Secret-, Private-Key- und Webhook-URL-Leaks.

## 9. Noch benötigte fachliche Antworten

1. Wie lange vor dem Probetraining soll der Kontakt erfolgen?
2. Welcher Kontaktweg wird im ersten Zap verwendet?
3. Welcher Text, Absender und Antwortweg sind freigegeben?
4. Welche Status-, Absage-, Archiv-, Opt-out-, Einwilligungs- und
   Bereits-kontaktiert-Regeln gelten?
5. Welche Standorte und Kontaktzeiten gehören in den ersten Pilot?
