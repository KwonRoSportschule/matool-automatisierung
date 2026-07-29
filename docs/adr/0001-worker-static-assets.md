# ADR 0001: Worker mit Static Assets statt getrenntem Pages-Projekt

Status: vorgeschlagen  
Datum: 29. Juli 2026

## Kontext

Die Anwendung benötigt eine Webseite, eine geschützte API, einen Cron Trigger,
D1-Bindings und Secrets. Cloudflare Pages kann die Webseite hosten, ein
geplanter Synchronisationsdienst benötigt dennoch Worker-Funktionalität.

Cloudflare empfiehlt für neue statische, SPA- und Full-Stack-Projekte Workers
Static Assets. Pages wird weiterhin unterstützt.

## Entscheidung

Die erste Implementierung wird als ein Cloudflare Worker mit Static Assets
geplant.

## Gründe

- UI, API und Cron werden gemeinsam versioniert und deployt.
- D1, Secrets und Laufzeitcode verwenden dieselbe Konfiguration.
- Keine zusätzliche öffentliche Worker-URL für die Pages-App notwendig.
- Preview-Versionen testen exakt die zusammengehörige Frontend-/Backend-Version.
- Cloudflare Workers Builds kann das GitHub-Repository direkt anbinden.

## Konsequenzen

- Die Anwendung erscheint im Cloudflare-Dashboard als Worker, nicht als
  klassisches Pages-Projekt.
- Statische Assets werden dennoch global über Cloudflare ausgeliefert.
- Ein Wechsel zu getrenntem Pages-Frontend bleibt möglich, erhöht aber
  Deployment- und Authentifizierungskomplexität.
- Für geschützte statische Dateien muss `assets.run_worker_first` die
  Worker-seitige Access-JWT-Prüfung ausführen.
- `workers.dev` und Preview-Versionen benötigen denselben Schutz oder werden
  deaktiviert.
- Preview-Builds verwenden einen getrennten Staging-Worker mit eigener D1 und
  eigenen Secrets; eine bloße neue Version mit Produktionsbindungen genügt
  nicht.

## Alternative

Wenn „Cloudflare Pages“ als Produktname verbindlich ist, wird ein Monorepo mit
separatem Pages- und Worker-Projekt verwendet. Diese Alternative ist funktional
möglich, aber nicht die empfohlene Ausgangsbasis.

## Referenzen

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/

