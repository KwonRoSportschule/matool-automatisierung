# Sicherheitsrichtlinie

## Schutzbedarf

Das Projekt verarbeitet potenziell personenbezogene Vertrags-, Kontakt- und
Mitgliedsdaten. MATOOL-Zugangsdaten, Session-Cookies, Zapier-Adressen und
Verlängerungstokens sind Geheimnisse.

Die untersuchte HAR enthält nicht leere Werte in den MATOOL-Loginfeldern. Vor
dem ersten PoC müssen das betroffene Passwort rotiert und bestehende Sessions
ungültig gemacht werden. Der in der HAR sichtbare Google-Maps-Schlüssel stammt
aus der MATOOL-Oberfläche: Er wird nicht wiederverwendet; seine
Anwendungseinschränkungen sind zu prüfen, ohne ihn ungeprüft als eigenes
Server-Secret zu behandeln.

## Verbotene Repository-Inhalte

Folgende Inhalte dürfen weder versioniert noch in Issues, Pull Requests,
Test-Snapshots oder Logs kopiert werden:

- HAR-Dateien und Browser-Netzwerkmitschnitte;
- produktive HTML-, JSON- oder PDF-Antworten aus MATOOL;
- Fotos oder Dokumente von Mitgliedern;
- E-Mail-Adressen, Telefonnummern, Geburtsdaten und Bankdaten realer Personen;
- MATOOL-Passwörter, Cookies und Session-IDs;
- Cloudflare-, Google-, Jotform- oder Zapier-Tokens und Webhook-URLs;
- unredigierte Fehlerantworten eines Produktivsystems.

Die `.gitignore` blockiert typische Dateimuster zusätzlich. Sie ersetzt keine
inhaltliche Prüfung vor einem Commit.

## Secret-Verwaltung

- Produktion: Cloudflare Secrets und eng berechtigte Plattformbindungen.
- Lokale Entwicklung: `.dev.vars`, niemals `.dev.vars.example`.
- CI/CD: nur Repository- oder Cloudflare-Secrets mit minimalen Berechtigungen.
- Cloudflare-Access-Service-Token, App-Bearer-Token und
  Webhook-Signierschlüssel sind getrennte Zugangsdaten und werden nicht
  wiederverwendet.
- Frontend: keine Geheimnisse, keine MATOOL-Zugangsdaten und keine
  Zapier-Webhook-URL im ausgelieferten JavaScript.
- Logs: Werte nur über eine feste Feld-Whitelist ausgeben.

## Testdaten

- Fixtures sind vollständig synthetisch.
- Reale Antworten werden nur lokal und temporär untersucht.
- Eine Fixture darf nicht durch bloßes Ersetzen von Namen pseudonymisiert
  werden; alle Personen-, Konto-, Vertrags-, Standort- und Dokumentkennungen
  müssen künstlich erzeugt sein.
- Parser-Tests müssen auch leere, verkürzte und unerwartete Antworten enthalten.

## Laufzeitregeln

- Admin-Webseite und Admin-API werden mit Cloudflare Access geschützt.
- Service-Endpunkte erhalten eine eigene Authentifizierung und eng begrenzte
  Rechte.
- `/api/zapier/v1/*` liegt zusätzlich hinter einer Cloudflare-Access-
  Service-Policy und verlangt im Worker einen unabhängigen Bearer-Token.
- Die Mitarbeiter-Anwendung und die pfadgenaue Service-Anwendung
  `/api/zapier/v1/*` besitzen unterschiedliche Access-Audiences. Der Worker
  lehnt eine gemeinsame Audience für Service-Aufrufe als Fehlkonfiguration ab.
- Die private Zapier-App bindet die erlaubte Middleware-Origin als
  App-Umgebungswert fest, sendet Zugangsdaten nur an diese exakte Origin und
  folgt dabei keinen Redirects.
- Der Worker validiert das Access-JWT auf Signatur, Aussteller, Zielgruppe und
  Ablaufzeit. Mitarbeiter-JWTs benötigen eine Benutzerkennung; Service-JWTs
  werden anhand des signierten `common_name` bei absichtlich leerem `sub`
  erkannt. Nicht geschützte `workers.dev`- oder Preview-URLs dürfen keinen
  Bypass bilden.
- Schreibende Adminaktionen prüfen zusätzlich CSRF-Token, `Origin` und
  `Content-Type`.
- Eingehende Zapier-, Jotform- oder andere Service-Callbacks verwenden
  Signatur, Zeitfenster und Replay-Schutz.
- Personenbezogene Antworten setzen `Cache-Control: no-store`.
- MATOOL wird nicht als frei adressierbarer Proxy nach außen abgebildet.
- Pro MATOOL-Konto läuft höchstens eine Sessionsequenz gleichzeitig, weil auch
  lesende Endpunkte den MATOOL-Sessionzustand verändern können.
- Ausgehende Requests verwenden eine feste Host-Allowlist. Redirects zu einem
  nicht freigegebenen Host werden abgebrochen, bevor Cookies oder Zugangsdaten
  weitergegeben werden.
- Login-Erfolg wird durch eine authentifizierte Folgeseite geprüft, nicht nur
  durch einen Redirect.
- Unbekannte Antwortformate führen zu einem Abbruch ohne Zustandsfortschreibung.

## Ereignisse und Zustellung

- `source_key` und `event_id` sind deterministisch und eindeutig.
- Der REST-Hook-Umschlag enthält keine Personendaten. Er wird zeitgebunden
  signiert und enthält einen einmaligen Delivery-Token, von dem D1 nur den
  Hash speichert.
- Eine atomare D1-Schreiboperation erlaubt je `event_id` höchstens einen
  Claim. Nur dieser erste Claim erhält die minimierte Ereignisnutzlast.
- Ein Empfänger muss ein Ereignis anhand der `event_id` deduplizieren können.
- Der Transport arbeitet mindestens einmal. Vor jeder externen Nebenwirkung
  muss das Ziel die `event_id` dauerhaft deduplizieren oder die Aktion selbst
  idempotent sein.
- Der technische Zustand wird erst nach einer bestätigten Speicherung oder
  Zustellung fortgeschrieben.
- Ein verlorener HTTP-Response darf höchstens einen sicheren Retry erzeugen,
  niemals ungeprüft eine zweite Kundenaktion.
- Nach dem letzten ambigen Transportversuch bleibt der ausgegebene Token bis zu
  seinem Ablauf claimbar; Lease-Ablauf allein darf diesen Claim nicht sperren.
- Ein späterer permanenter Transportfehler darf einen noch gültigen Token aus
  einem älteren ambigen oder akzeptierten Versuch nicht vorzeitig entwerten.
- Erstimport und produktive Freigabe sind technisch getrennt.

## Verlängerungslinks

Personendaten gehören nicht in Query-Parameter. Ein späterer öffentlicher
Verlängerungslink verwendet:

- mindestens 128 Bit kryptografischen Zufall;
- einen in D1 nur gehasht gespeicherten Token;
- einen festgelegten Ablaufzeitpunkt;
- eine Bindung an genau einen freigegebenen Vorgang;
- serverseitige Gültigkeits- und Statusprüfung;
- Widerrufbarkeit und Auditierung ohne Tokenwert im Log.

Auch ein undurchsichtiger Token und technische Werte wie `source_key`,
`event_id` oder Hashes können personenbeziehbare pseudonyme Daten sein. Sie
werden deshalb nicht als anonyme Logdaten behandelt.

Für die Token-Seite gelten zusätzlich:

- `Referrer-Policy: no-referrer` und eine restriktive Content Security Policy;
- keine Drittanbieter-Skripte, externen Bilder oder Analytics;
- kein Token in Access-, Proxy- oder Anwendungslogs;
- bevorzugt ein einmaliger Token im URL-Fragment, der über ein
  First-Party-POST gegen eine kurzlebige `HttpOnly`-Session getauscht und
  anschließend aus der Browseradresse entfernt wird.

## Vorgehen bei einem Secret-Leak

1. Betroffenes Secret sofort deaktivieren oder rotieren.
2. Produktivzugriffe und Logs auf Missbrauch prüfen.
3. Secret aus Git-Historie und Artefakten entfernen.
4. Abhängige Sessions und Tokens ungültig machen.
5. Ursache und Gegenmaßnahme ohne Secretwerte dokumentieren.
