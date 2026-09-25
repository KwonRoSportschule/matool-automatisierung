# Deployment-Audit vom 22.09.2026

## Ergebnis

Der am 10.09.2026 veröffentlichte Worker lässt sich aus der gesicherten
Ausgangsfassung des Hauptarbeitsverzeichnisses reproduzieren. Der vollständige
Vergleich des heruntergeladenen Live-Bundles mit einem neuen lokalen
Wrangler-Build zeigt **keinen Unterschied im ausführbaren Code**. Es unterscheiden
sich ausschließlich 22 automatisch erzeugte Kommentare mit relativen Pfaden zur
Abhängigkeit `jose`.

Damit ist `.tmp/baseline-20260922-0827` die nachgewiesene Ausgangsbasis für die
jetzige Fehlerbehebung. Sie enthält neben Commit `91bc175` auch die zuvor
nicht eingecheckten Änderungen. Weder `origin/main` allein noch der andere
Worktree `fb26` sind eine gleichwertige Deployment-Grundlage.

Der Nachweis bezieht sich auf den **Worker-Code und die unten geprüfte
Laufzeitkonfiguration**. Die statischen Frontend-Assets wurden nicht mit dem
veröffentlichten Frontend verglichen. Ein vollständiger Web-Build beim nächsten
Deployment kann deshalb bereits vorhandene, bisher nicht ausgelieferte
Frontendänderungen sichtbar machen.

## Live-Version und Git-Stände

| Merkmal | Verifizierter Wert |
| --- | --- |
| Worker | `matool-middleware-staging` |
| Aktive Deployment-ID | `d7b71e59-88e6-4855-9d93-b9690da32bce` |
| Aktive Version, 100 % Traffic | `a1728193-ccd5-4150-9bd4-fa427e558602` |
| Versionsnummer | `109` |
| Version erstellt | 10.09.2026, 07:59:54 UTC |
| Deployment erstellt | 10.09.2026, 07:59:57 UTC |
| Deployment-Quelle | `wrangler` |
| Commit-/Build-Annotation | Nicht vorhanden |
| Script-ETag | `9324a405847c8367520cf35bed8f9e0b13a07db172220affe360ade41aa3841b` |
| Lokaler HEAD beim Ausgangssnapshot | `91bc1751b9f1694ad7b95713cd419b35f4083e23` |
| GitHub `main`, mit `git ls-remote` geprüft | `e8d51b8cab187f1c17114eb9e82c5d659ea69d0a` |
| GitHub Paritätsbranch | `4bef9b57309c9129414d32b5226cf2471a257829` |
| Anderer Worktree `fb26`, HEAD | `e37ca8f` plus eigene nicht eingecheckte Änderungen |

`91bc175` ergänzt gegenüber GitHub `main` die CPU-/Subrequest-Grenzen in
Staging. Die Live-Version wurde später erzeugt, trägt aber keinen Git-Verweis.
Der Bundlevergleich schließt diese Nachweislücke für die gesicherte lokale
Ausgangsfassung; er macht den Git-Commit allein nicht zum vollständigen
Quellstand.

## Vollständiger Bundlevergleich

Live-Download am 22.09.2026 um 08:53:57 UTC über den dokumentierten,
rein lesenden Cloudflare-Endpunkt
`GET /accounts/{account}/workers/scripts/{worker}/content/v2`.

`wrangler init --from-dash` wurde nicht benutzt: Der installierte Wrangler
4.115.0 verweigert diesen Weg für Workers mit Assets. Das wurde im lokalen
CLI-Code geprüft. Die vorhandene Wrangler-Anmeldung wurde ausschließlich im
Arbeitsspeicher verwendet; Zugangsdaten wurden weder ausgegeben noch in den
Auditdateien gespeichert.

| Artefakt | Größe | SHA-256 |
| --- | ---: | --- |
| `.tmp/deployment-audit-20260922/live/index.js` | 448.862 Bytes | `37c8a5a91fcbb46af72dff3e4ac8f6ae4a35589d5d9e82cdde35cb2b3c2aa5b8` |
| `.tmp/deployment-audit-20260922/baseline-build/index.js` | 448.994 Bytes | `5d7a4aeb7e9658ecaef9fe63ed0f8e39d547d9f724b3c8c683e5d69cc400e08e` |
| Baseline-Bundle nach ausschließlicher Kommentar-Pfadkorrektur | 448.862 Bytes | `37c8a5a91fcbb46af72dff3e4ac8f6ae4a35589d5d9e82cdde35cb2b3c2aa5b8` |

Einzige Normalisierung:

```text
// ../../node_modules/  →  // node_modules/
```

Sie betrifft ausschließlich Zeilen am Zeilenanfang, keine Zeichenketten oder
Programmanweisungen. Die 22 zusätzlichen `../../`-Präfixe erklären exakt die
132 zusätzlichen Bytes. Nach dieser Korrektur sind die vollständigen Dateien
zeichenweise identisch.

Die 34 eigenen Quellabschnitte sind unverändert:

| Gruppe | Identische Abschnitte |
| --- | --- |
| Kernfunktionen | `app-error`, `http`, `crypto`, `first-trial`, `zapier-payload` |
| MATOOL | `response-shape`, `artikel-detail`, `checkin`, `cookie-jar`, `graduierung`, `klassen-detail`, `schueler-detail`, `client` |
| Interessenten-/Snapshot-Sync | `interessenten-sync-store`, `matool-store`, `exact-sync-safety`, `interessenten-sync-workflow`, `schedule-window`, `sync-store`, `schedule` |
| Dashboard/HTTP/Zugriff | `access`, `csrf`, `dashboard-privacy`, `dashboard-repository`, `dashboard-query`, `integration-auth`, `index` |
| Zustellung/Zapier | `sinks/zapier`, `delivery-repository`, `outbox`, `repository`, `snapshot-delivery-store`, `snapshot-delivery`, `zapier-api` |

Der lokale Vergleichsbuild wurde mit `wrangler deploy --dry-run`,
`--env staging`, der Konfiguration aus dem Ausgangssnapshot und einem separaten
Audit-Ausgabeverzeichnis erzeugt. Es fand kein Upload statt. Details und alle
abweichenden Kommentarzeilen stehen in
`.tmp/deployment-audit-20260922/bundle-comparison.json`; das lokale
Prüfskript ist `compare-bundles.mjs` im selben Verzeichnis.

## Abgrenzung des anderen Worktrees und der Staging-Daten

Das Live-Bundle enthält **keine Referenz auf
`interessenten_sync_staged_lists`**. Es verwendet:

- Detail-Batches mit 100 Datensätzen;
- bis zu zehn Listenzyklen;
- `scanAndStartCycle`, `persistDetailBatch` und `finishOrRestartCycle`;
- eine abschließende erneute Listenaufnahme und gegebenenfalls einen Neustart
  des Zyklus.

Im Worktree `C:/Users/CorinKeil/.codex/worktrees/fb26/matool-automatisierung`
liegen dagegen unter anderem folgende zusätzliche, nicht aktuell ausgelieferte
Änderungen:

- seitenweise Listenaufnahme und Persistierung in `interessenten_sync_staged_lists`;
- neue Staging-, Verifikations- und Commit-Funktionen im Sync-Store;
- Detail-Batches mit 20 Datensätzen;
- ein einzelner Zyklus mit `finalizeCycle` statt abschließendem
  Quelllisten-Neuabgleich;
- eine eigene Migration `0010_interessenten_sync_staged_lists.sql`;
- abweichende MATOOL-Client-, Schedule-, Snapshot-, Zapier- und
  Dashboardstände, teilweise ohne neuere Dateien aus dem Hauptarbeitsverzeichnis.

Dieser Worktree darf nicht pauschal in das Live-System übernommen werden.
Insbesondere würden Änderungen an Listenstabilität und Vollständigkeitsprüfung
mit einer bloßen Fehlerdiagnose vermischt. Der vollständige Live-/Baselinebeweis
macht eine Übernahme zur Wiederherstellung des veröffentlichten Codes unnötig.

Die vorhandenen 241.926 Staging-Zeilen werden vom aktuell aktiven Worker-Code
nicht erzeugt. Sie belegen frühere Nutzung eines anderen Ablaufs; Zeitpunkt,
Erzeugerversion und mögliche noch an ältere Versionen gebundene Workflowinstanzen
müssen vor einer Bereinigung separat geprüft werden. Aus ihrer Anzahl allein
darf kein aktuelles Wachstum durch Version 109 abgeleitet werden.

## Verifizierte Laufzeitkonfiguration

Die geprüften Werte entsprechen der Staging-Konfiguration im Ausgangssnapshot:

- Kompatibilitätsdatum `2026-07-29`, CPU-Limit `300000`, Subrequests `10000`.
- D1-Binding `DB` auf `4e002f53-31da-4212-bb46-c38ce05a36e2`.
- Workflow-Binding `INTERESSENTEN_SYNC_WORKFLOW` auf
  `matool-interessenten-sync-staging`, Klasse `InteressentenSyncWorkflow`.
- Assets-Binding `ASSETS`; `not_found_handling=none`, `run_worker_first=true`.
- `APP_ENV=staging`, `MATOOL_BASE_URL=https://core.matool.de`.
- `OUTBOUND_DELIVERY_ENABLED=false`.
- `PUBLIC_DASHBOARD_FULL_ACCESS=true`, `PUBLIC_DASHBOARD_READ_ONLY=true`,
  `PUBLIC_DASHBOARD_PLAINTEXT=true`.
- Access-Audience und Team-Domain entsprechen der vorhandenen Konfiguration;
  Service-Audience bleibt der Platzhalter.
- Secret-Bindings sind vorhanden für `CSRF_SECRET`, `MATOOL_EMAIL`,
  `MATOOL_PASSWORD`, `MATOOL_REAL_RUNS_ENABLED`, `ZAPIER_SERVICE_TOKEN`.
  Secretwerte wurden nicht abgerufen.
- Cron: `0 7-18 * * mon-fri`, zuletzt geändert am 10.09.2026 um 08:00:05 UTC.

Der Cron-Ausdruck enthält zwölf mögliche UTC-Zeitpunkte. Die Aussage über elf
fachliche Tagesläufe muss weiterhin auf der Zeitfensterlogik und den tatsächlich
gespeicherten Läufen beruhen, nicht allein auf dem Cron-Ausdruck.

## GitHub Actions und Cloudflare Builds

Die vorhandene `.github/workflows/ci.yml` führt `pnpm run ci` aus und enthält
keinen Deployment-Schritt. Das sagt nichts über separat in Cloudflare
konfigurierte Git-Builds aus.

Beide gezielten Cloudflare-Builds-Abfragen lieferten HTTP 403:

- `GET /builds/workers/6273014e499d4b288a6d2345d4f07019/triggers`;
- `GET /builds/builds?version_ids=a1728193-ccd5-4150-9bd4-fa427e558602`.

Die vorhandene Wrangler-OAuth-Anmeldung weist keine `workers_builds`-Scopes aus.
Ob Cloudflare Builds eingerichtet ist, bleibt deshalb **unbekannt**. Insbesondere
ist aus `source=wrangler` und einer reinen GitHub-Prüfpipeline kein Beweis für
„kein Autodeploy“ ableitbar. Vor einem Git-Push, der ein fremd konfiguriertes
Deployment auslösen könnte, muss diese Ungewissheit berücksichtigt werden.

## Sichere Fortsetzung

1. Die gesicherte Hauptworkspace-Ausgangsfassung einschließlich der damaligen
   unversionierten Dateien als Basis behalten. Die konkrete Diagnosekorrektur
   dagegen als prüfbaren Diff abgrenzen.
2. Keine `fb26`-Implementierung zur vermeintlichen Wiederherstellung von
   Live-Code importieren. Die eventuell benötigte historische Staging-Migration
   ist eine getrennte Aufgabe zur Rekonstruktion der Datenbankhistorie.
3. Den bestehenden Runtime- und Secret-Bestand beim Diagnose-Deployment
   erhalten; Frontend-Assets bewusst neu bauen oder gezielt erhalten.
4. Neue Worker-Versionen mit Commit-/Build-Kennung markieren und die verwendete
   Baseline bzw. den vollständigen Quellstand versionieren. Metadaten allein
   reichen aktuell noch nicht zur Reproduktion.
5. Vor einer Datenbereinigung laufende und versionsgebundene Workflowinstanzen,
   D1-Wiederherstellungspunkt und tatsächliche Retention prüfen.

## Auditdateien und technische Grenzen

Alle regulären Auditdateien liegen im ignorierten Ordner
`.tmp/deployment-audit-20260922`. Keine Quelldatei, Datenbank oder veröffentlichte
Worker-Version wurde durch diesen Audit verändert.

Beim ersten Download entstand durch zunächst nicht dekodierte URL-Leerzeichen
zusätzlich eine identische Kopie von Bundle, Manifest und Servicemetadaten unter
`C:/Users/CorinKeil/KwonRo%20Sportschule/Verwaltung%20-%20General/KI/GitHub/matool-automatisierung/.tmp/deployment-audit-20260922`.
Der Pfadfehler wurde korrigiert; die oben verwendeten Nachweise stammen aus dem
korrekten Projektordner. Bestehende Dateien wurden dabei nicht überschrieben.

Ein zusätzlicher, für den Live-/Baselinebeweis nicht erforderlicher Build des
Worktrees `fb26` wurde von der automatischen Freigabeprüfung wegen fehlender
Workspace-Credits nicht ausgeführt. Diese Ablehnung war ein Prüfungsfehler,
keine Sicherheitsbewertung. Der bereits erfolgreich erzeugte Baseline-Build
und sein vollständiger Vergleich bleiben davon unberührt.

Quellen für die verwendeten Nur-Lese-Endpunkte:
[Worker-Script-Inhalt](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/),
[Cloudflare Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).
