# MATOOL Middleware Hub

Interne Middleware zwischen MATOOL und Zapier für die KwonRo Sportschule.

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
- Empfohlener Pilot: Vertragsverlängerung 42 Tage vor Ablauf der Grundlaufzeit.
- Architekturentscheidungen sind als **vorgeschlagen**, noch nicht als fachlich
  freigegeben dokumentiert.

## Empfohlenes Zielbild

Ein Cloudflare Worker stellt sowohl die geschützte Admin-Webseite als auch die
Middleware-API bereit. Statische Dateien werden als Workers Static Assets
ausgeliefert. Ein Cron Trigger startet die Synchronisation; D1 speichert Runs,
minimale Datensätze, Ereignisse und Zustellversuche.

```text
Admin-Webseite / Cron
        |
        v
Cloudflare Worker
   |       |       |
   v       v       v
MATOOL    D1    Ausgabeadapter
                     |
                     v
                   Zapier
```

Cloudflare Pages bleibt eine mögliche Alternative. Für ein neues kombiniertes
Frontend-/Backend-Projekt empfiehlt Cloudflare inzwischen Workers Static Assets,
weil UI, API, Bindings, Cron und Observability gemeinsam deployt werden können.

## Sicherheitsgrundsätze

- Keine HAR-Dateien, Rohantworten, Fotos, Passwörter, Cookies oder Webhook-URLs
  in Git.
- Secrets nur über Cloudflare Secrets beziehungsweise lokal über eine
  ignorierte `.dev.vars`.
- Nur explizit freigegebene Felder verarbeiten.
- Keine allgemeine Proxy-API zu MATOOL bereitstellen.
- Keine Personenkennungen in Verlängerungs-URLs; stattdessen undurchsichtige,
  zeitlich begrenzte Tokens.
- Ein Erstimport baut nur eine Baseline auf und löst keine Kundenaktion aus.
- Ein unvollständiger Abruf erzeugt weder Löschungen noch negative Ereignisse.

Weitere Regeln stehen in [SECURITY.md](SECURITY.md).

## Planungsdokumente

- [Zielarchitektur](docs/architecture.md)
- [Umsetzungs- und Abnahmeplan](docs/implementation-plan.md)
- [Sanitisierte HAR-Analyse](docs/har-analysis.md)
- [Pilotspezifikation GLZ](docs/pilot-glz.md)
- [Offene Entscheidungen](docs/open-decisions.md)
- [ADR 0001: Workers Static Assets](docs/adr/0001-worker-static-assets.md)
- [ADR 0002: D1 statt KV](docs/adr/0002-d1-state.md)
- [ADR 0003: Sichere Verlängerungslinks](docs/adr/0003-safe-renewal-links.md)

## Abgrenzung des ersten Piloten

Der erste Pilot ist gegenüber MATOOL ausschließlich lesend:

1. Bei MATOOL anmelden.
2. Kandidaten mit Vertragsende in 42 Tagen ermitteln.
3. Daten validieren und minimieren.
4. Baseline beziehungsweise deduplizierte Testereignisse in D1 speichern.
5. Ergebnisse im geschützten Adminbereich anzeigen.

E-Mail-Versand, Vertragsänderungen und produktive Zapier-Folgeaktionen bleiben
bis nach Shadow-Betrieb und fachlicher Abnahme deaktiviert.
