# MATOOL Middleware Hub

Internes Mitarbeiter-Dashboard und Middleware zwischen MATOOL und Zapier für
die KwonRo Sportschule.

Das Projekt soll freigegebene Daten aus MATOOL über dessen bestehende
Weboberfläche abrufen, fachliche Änderungen zuverlässig erkennen und daraus
deduplizierte Ereignisse für Zapier erzeugen. MATOOL stellt dafür keine
öffentliche API bereit; deshalb wird ausschließlich der technisch verifizierte
HTTP-Verkehr der Webanwendung nachgebildet.

## Aktueller Stand

Stand: 29. Juli 2026

- Bestandsaufnahme von Repository, Projektplan, HAR und Altprozess abgeschlossen.
- Noch keine Verbindung zu einem produktiven MATOOL-, Cloudflare-, Google- oder
  Zapier-Konto.
- Noch keine Zugangsdaten im Repository.
- Bestätigtes Hosting: Cloudflare Worker mit Static Assets.
- Bestätigte Oberfläche: ausschließlich ein internes Mitarbeiter-Dashboard.
- Bestätigter erster Pilot: Interessenten vor ihrem ersten Probetraining
  automatisiert kontaktieren.
- Zapier Professional ist vorhanden.
- Eine bestehende private Zapier-MATOOL-App ist nicht verfügbar; die benötigte
  private Zapier-App und ihr REST-Hook-Protokoll werden deshalb in diesem
  Projekt neu gebaut. Das technische Grundgerüst liegt lokal vor, ist aber noch
  mit keinem produktiven Zapier-Konto verbunden.

## Bestätigtes Zielbild

Ein Cloudflare Worker stellt sowohl die geschützte Admin-Webseite als auch die
Middleware-API bereit. Statische Dateien werden als Workers Static Assets
ausgeliefert. Ein Cron Trigger startet die Synchronisation; D1 speichert Runs,
minimale Datensätze, Ereignisse und Zustellversuche.

```text
Mitarbeiter-Dashboard / Cron
              |
              v
      Cloudflare Worker <----> D1
          |        |
          v        +---- PII-freier REST-Hook-Umschlag ----+
       MATOOL                                             v
                                                private Zapier-App
                                                    |         |
                                     Claim/Ergebnis |         v
                                                    +---- Zapier-Ablauf
```

Die bestätigte Implementierung verwendet Workers Static Assets, damit UI, API,
Bindings, Cron und Observability gemeinsam deployt werden können. Ein getrenntes
Cloudflare-Pages-Projekt ist nicht Teil des Zielbilds.

Die private Zapier-App verwendet einen echten REST-Hook-Trigger mit dynamischer
An- und Abmeldung, keinen manuell kopierten Catch Hook und kein Polling. Der
Hook enthält keine Personendaten. Erst ein einmaliger, atomarer Claim über die
Middleware liefert die freigegebene Ereignisnutzlast; der letzte Zap-Schritt
meldet Erfolg oder einen technischen Fehler zurück.

## Sicherheitsgrundsätze

- Keine HAR-Dateien, Rohantworten, Fotos, Passwörter, Cookies oder Webhook-URLs
  in Git.
- Secrets nur über Cloudflare Secrets beziehungsweise lokal über eine
  ignorierte `.dev.vars`.
- Nur explizit freigegebene Felder verarbeiten.
- Keine allgemeine Proxy-API zu MATOOL bereitstellen.
- Der Zapier-Hook-Umschlag enthält ausschließlich technische IDs, Ereignistyp,
  Schemaversion und einen kurzlebigen Delivery-Token, aber keine Personendaten.
- Jeder Klartext-Delivery-Token wird nur im zugehörigen Hook-Versuch
  übertragen; D1 speichert ausschließlich seinen Hash.
- Zapier-Service-Endpunkte verlangen sowohl einen Cloudflare-Access-
  Service-Token als auch einen unabhängigen App-Bearer-Token.
- Mitarbeiter- und Zapier-Service-Routen verwenden getrennte Cloudflare-
  Access-Anwendungen mit unterschiedlichen Audience-Werten.
- Keine Personenkennungen in Verlängerungs-URLs; stattdessen undurchsichtige,
  zeitlich begrenzte Tokens.
- Ein Erstimport baut nur eine Baseline auf und löst keine Kundenaktion aus.
- Ein unvollständiger Abruf erzeugt weder Löschungen noch negative Ereignisse.

Weitere Regeln stehen in [SECURITY.md](SECURITY.md).

## Erste Staging-Version hosten

Die erste sichere Version läuft über
`matool-middleware-staging.<account>.workers.dev`. Sie enthält das Dashboard,
aber keine aktive Automatisierung: Outbound-Zustellung bleibt deaktiviert,
Cron bleibt leer und der Prozess startet im Modus `disabled`.

Nach Cloudflare-Login, Anlage der EU-D1-Datenbank und Einsetzen ihrer ID:

```text
pnpm run db:migrate:staging
pnpm run deploy:staging
```

Anschließend muss für die `workers.dev`-Route Cloudflare Access aktiviert und
auf die freigegebenen Mitarbeiter begrenzt werden. Die dabei erzeugte
Access-Audience sowie die Team-Domain werden in `env.staging` eingetragen und
nochmals mit `pnpm run deploy:staging` veröffentlicht.

## Planungsdokumente

- [Zielarchitektur](docs/architecture.md)
- [Umsetzungs- und Abnahmeplan](docs/implementation-plan.md)
- [Inbetriebnahme-Runbook](docs/deployment-runbook.md)
- [Sanitisierte HAR-Analyse](docs/har-analysis.md)
- [Aktiver Pilot: Interessenten vor dem ersten Probetraining](docs/pilot-interessenten.md)
- [Offene Entscheidungen](docs/open-decisions.md)
- [Spätere Prozessnotiz: Verlängerung nach GLZ](docs/pilot-glz.md)
- [ADR 0001: Workers Static Assets](docs/adr/0001-worker-static-assets.md)
- [ADR 0002: D1 statt KV](docs/adr/0002-d1-state.md)
- [ADR 0003: Sichere Verlängerungslinks](docs/adr/0003-safe-renewal-links.md)

## Abgrenzung des ersten Piloten

Der erste Pilot liest MATOOL ausschließlich lesend und bereitet die
automatisierte Kontaktaufnahme mit Interessenten vor ihrem ersten Probetraining
vor:

1. Bei MATOOL anmelden.
2. Interessenten mit geplantem ersten Probetraining ermitteln.
3. Termin-, Status- und Kontaktdaten nach einer freizugebenden Feld-Whitelist
   validieren und minimieren.
4. Baseline beziehungsweise deduplizierte
   `prospect.first_trial_contact_due`-Testereignisse in D1 speichern.
5. Ergebnisse ohne unmaskierte Personendaten im geschützten Mitarbeiterbereich
   anzeigen.
6. Die private Zapier-App per REST Hook abonnieren, einen PII-freien Umschlag
   zustellen und Claim sowie Ergebnisaktion ausschließlich mit synthetischen
   Ereignissen testen.

Produktive Kontaktaufnahme, Änderungen in MATOOL und produktive
Zapier-Folgeaktionen bleiben bis nach Shadow-Betrieb und fachlicher Abnahme
deaktiviert. Die Verlängerung nach GLZ ist eine spätere Ausbaustufe und nicht
Teil dieses Piloten. Insbesondere bleiben die MATOOL-Felder für den ersten
Probetrainingstermin sowie Vorlauf, Kontaktmedium, Einwilligungs- und
Ausschlussregeln weiterhin offen. Auch die Idempotenz der späteren externen
E-Mail-, SMS- oder sonstigen Kontaktaktion ist noch nicht nachgewiesen.

## Lokale Qualitätsprüfung

```text
pnpm install --frozen-lockfile
pnpm run ci
```

`pnpm run ci` prüft TypeScript, Worker-/D1-/Zapier-Verträge, Frontend- und
Worker-Build, Repository-Secrets, die lokale Zapier-Plattformstruktur und das
tatsächliche Zapier-ZIP-Packaging.
Dieselbe Grenze läuft in GitHub Actions bei Pull Requests und Änderungen an
`main`. Die CI verwendet Zapier dabei mit `--without-style` und sendet die
App-Definition nicht an den optionalen Stilprüfdienst. Sie führt ausdrücklich
kein Deployment und keinen Echtdatenzugriff aus. Die vollständige
Stilvalidierung kann vor einem späteren privaten Upload bewusst mit
`pnpm run validate:zapier` ausgeführt werden.
