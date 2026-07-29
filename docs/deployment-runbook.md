# Inbetriebnahme-Runbook

Status: vorbereitet, noch nicht ausgeführt  
Stand: 29. Juli 2026

Dieses Runbook beginnt absichtlich mit einer deaktivierten Staging-Umgebung.
Es autorisiert weder einen Echtdatenabruf noch eine Kundenkontaktaktion.
Zugangsdaten werden nie als Befehlsargument, in Git oder im Chat abgelegt.

## 1. Freigaben vor jeder Kontoänderung

Vor dem ersten Cloudflare- oder Zapier-Upload werden benötigt:

- freigegebene Staging- und Produktions-Hostnamen;
- Cloudflare-Konto und verwaltete DNS-Zone;
- erlaubte Mitarbeiteridentitäten oder -gruppe;
- Bestätigung der D1-EU-Jurisdiktion und Aufbewahrungsfristen;
- Entscheidung, ob das lokale Repository in das bereits konfigurierte
  GitHub-Remote übertragen werden darf;
- rotierendes MATOOL-Passwort und invalidierte Altsessions, bevor irgendein
  realer MATOOL-Aufruf stattfindet;
- interne Autorisierung eines eng begrenzten, lesenden Strukturtests.

Die fachlichen Regeln für Zeitpunkt, Kanal, Einwilligung und Ausschlüsse sind
kein Gate für einen deaktivierten Staging-Deploy, wohl aber für Baseline,
Shadow-Betrieb und jede Zapier-Folgeaktion.

## 2. Lokale Qualitätsgrenze

Vom Repository-Stamm:

```text
pnpm install --frozen-lockfile
pnpm run ci
```

Erwartet werden ein grüner Typecheck, sämtliche Worker-/D1-/Zapier-Tests, der
Worker-Dry-Run, der Repository-Scanner und eine lokale Zapier-Strukturprüfung
ohne Fehler. Zusätzlich muss das echte Zapier-Build-/ZIP-Packaging erfolgreich
sein. Der CI-Aufruf `--without-style` vermeidet die optionale
Server-Stilprüfung. Die vollständige Stilvalidierung und ihre bekannten
Hinweise für eine nicht öffentlich gelistete, deutschsprachige private App
werden vor dem privaten Upload getrennt ausgeführt und dokumentiert.

## 3. Cloudflare-Ressourcen

Staging und Produktion erhalten getrennte Worker, Datenbanken, Hostnamen,
Access-Anwendungen und Secrets.

### 3.1 D1 in EU-Jurisdiktion erstellen

Diese Befehle verändern das Cloudflare-Konto und werden erst nach ausdrücklicher
Freigabe interaktiv ausgeführt:

```text
pnpm exec wrangler d1 create matool-middleware-staging --jurisdiction=eu
pnpm exec wrangler d1 create matool-middleware-production --jurisdiction=eu
```

Die ausgegebenen UUIDs werden ausschließlich in die jeweils passende
`database_id` unter `env.staging` beziehungsweise `env.production` in
`wrangler.jsonc` übernommen. Die Datenbank-UUID ist kein Secret, dennoch wird
die Zuordnung vor dem ersten Remote-Befehl zweifach geprüft.

### 3.2 Eigene Hostnamen festlegen

Für den schnellen ersten Staging-Stand ist `workers_dev` aktiviert und
`preview_urls` deaktiviert. Die Staging-Adresse lautet damit
`matool-middleware-staging.<account>.workers.dev` und wird direkt nach dem
ersten Deploy über **Workers & Pages → Worker → Domains & Routes → workers.dev
→ Enable Cloudflare Access** geschützt. Produktion behält `workers_dev=false`
und erhält später eine eigene Custom Domain. Nach der fachlichen Auswahl wird
für Produktion genau eine Route ergänzt:

```json
{
  "routes": [
    {
      "pattern": "<staging-hostname>",
      "custom_domain": true
    }
  ]
}
```

Staging- und Produktionshostname dürfen nicht identisch sein. Der endgültige
HTTPS-Origin ist später der fest gepinnte Wert
`MATOOL_MIDDLEWARE_ORIGIN` der jeweiligen privaten Zapier-App-Version.

## 4. Cloudflare Access

Pro Umgebung werden zwei selbst gehostete Access-Anwendungen angelegt:

1. Mitarbeiter-Anwendung für den gesamten Host mit einer Allow-Policy nur für
   die freigegebenen Mitarbeiteridentitäten.
2. Spezifischere Service-Anwendung ausschließlich für
   `/api/zapier/v1/*` mit einer Service-Auth-Policy für genau einen
   umgebungsspezifischen Service-Token.

Bei überlappenden Access-Pfaden hat die spezifischere Anwendung Vorrang. Die
beiden Anwendungen müssen unterschiedliche Audience-Werte besitzen:

```text
ACCESS_AUD=<Audience der Mitarbeiter-Anwendung>
ACCESS_SERVICE_AUD=<Audience der Zapier-Service-Anwendung>
ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
```

Der Worker prüft die zur Route passende Audience nochmals selbst und lehnt für
Service-Aufrufe eine gemeinsame Audience als Fehlkonfiguration ab. Der
Cloudflare-Service-Token darf keiner Mitarbeiter-Policy hinzugefügt werden.

## 5. Secrets in Staging

Secrets werden über die interaktive Standardeingabe gesetzt, niemals hinter
dem Befehlsnamen ausgeschrieben. `versions secret put` erzeugt zunächst eine
Worker-Version; der anschließende kontrollierte Deploy übernimmt die
vorhandenen Secrets.

Für den ersten deaktivierten Deploy:

```text
pnpm exec wrangler versions secret put CSRF_SECRET --env staging
```

Erst für den synthetischen Zapier-Test:

```text
pnpm exec wrangler versions secret put ZAPIER_SERVICE_TOKEN --env staging
pnpm exec wrangler versions secret put ZAPIER_WEBHOOK_SIGNING_SECRET --env staging
```

Erst nach Passwortrotation und read-only-Freigabe:

```text
pnpm exec wrangler versions secret put MATOOL_EMAIL --env staging
pnpm exec wrangler versions secret put MATOOL_PASSWORD --env staging
pnpm exec wrangler versions secret put MATOOL_REAL_RUNS_ENABLED --env staging
```

Für `MATOOL_REAL_RUNS_ENABLED` ist ausschließlich der Kontrollwert
`confirmed-read-only` zulässig. App-Bearer-Token, Access-Service-Token und
Webhook-Signierschlüssel sind drei verschiedene Zufallswerte.

## 6. Deaktiviertes Staging ausrollen

Vor dem Upload bleiben in `env.staging`:

```text
OUTBOUND_DELIVERY_ENABLED=false
triggers.crons=[]
```

Danach:

```text
pnpm run ci
pnpm exec wrangler d1 migrations apply DB --remote --env staging
pnpm run build:web
pnpm exec wrangler deploy --env staging --strict
```

Die Migration wird nur gegen die zuvor geprüfte Staging-Bindung ausgeführt.
Der erste Deploy darf weder MATOOL abrufen noch Outbox-Zustellungen auslösen.

## 7. Staging-Abnahme ohne Echtdaten

Zu prüfen und zu protokollieren:

- `/healthz` enthält nur Dienstname, Schemaversion und `ok`;
- Assets und Admin-API sind ohne Mitarbeiter-Access nicht erreichbar;
- Mitarbeiterlogin zeigt den Prozessmodus `disabled`;
- die Zapier-Service-Audience wird an Admin-Routen abgewiesen;
- ein Service-Aufruf benötigt Access-Service-Token und zusätzlichen
  App-Bearer-Token;
- D1 enthält nur Migrationen und synthetische Datensätze;
- Cron und ausgehende Zustellung bleiben deaktiviert;
- Logs enthalten keine Header-, Token-, Hook- oder Personenwerte.

## 8. Private Zapier-App anbinden

Registrierung und Upload sind externe Änderungen und erfolgen erst nach
ausdrücklicher Freigabe aus `zapier-app`:

```text
zapier-platform login
zapier-platform register "KwonRo MATOOL Middleware"
pnpm run zapier:build
zapier-platform push
zapier-platform env:set 0.1.0 MATOOL_MIDDLEWARE_ORIGIN=https://<staging-hostname>
```

Die Versionsnummer muss dabei der tatsächlich hochgeladenen Version
entsprechen. Die private Zapier-Verbindung enthält ausschließlich:

- Cloudflare Access Client-ID;
- Cloudflare Access Client-Secret;
- Middleware Service-Token;
- Webhook-Signierschlüssel.

MATOOL-Zugangsdaten gehören nicht nach Zapier. Zunächst wird nur ein
synthetisches Ereignis abonniert, zugestellt, atomar geclaimt und mit einer
ungefährlichen Testaktion bestätigt.

Das reine Editor-Beispiel ist nur für das Feld-Mapping bestimmt und erzeugt
keinen D1-Claim. Die Ergebnisaktion darf deshalb nicht mit der Sample-Claim-ID
als angeblich erfolgreich abgenommen werden, sondern nur mit dem Claim des
tatsächlich erzeugten synthetischen Ereignisses.

## 9. Aktivierungsleiter

Jede Stufe wird separat abgenommen:

1. deaktivierter Staging-Deploy;
2. autorisierte read-only Strukturprobe ohne Rohdatenpersistenz;
3. synthetische Parser-Fixtures;
4. aktionsfreie Baseline;
5. mindestens zehn stabile Shadow-Läufe;
6. synthetischer Zapier-End-to-End-Test;
7. Nachweis der Idempotenz des gewählten Kontaktziels;
8. begrenzter Pilot mit freigegebenen Regeln und Empfängern;
9. Produktion erst nach dokumentierter Staging-Abnahme.

`OUTBOUND_DELIVERY_ENABLED`, Cron und Kundenaktionen werden niemals gemeinsam
in einem einzigen ungetesteten Schritt aktiviert.

## 10. Rollback und Secret-Vorfall

Vor jeder Aktivierung wird die aktuelle funktionierende Worker-Version notiert.
Ein Code-Rollback erfolgt interaktiv auf genau diese Version:

```text
pnpm exec wrangler rollback <version-id> --env staging
```

Ein Rollback entfernt keine möglicherweise kompromittierten Secrets. Bei einem
Secret-Vorfall werden zuerst betroffene Tokens beziehungsweise Passwörter
rotiert und Sessions invalidiert, anschließend Logs geprüft und erst danach der
Betrieb wieder freigegeben.

## Referenzen

- [Cloudflare D1: Data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- [Cloudflare Workers: Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Access: Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Cloudflare Access: Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Zapier Platform CLI](https://docs.zapier.com/integrations/build-cli/overview)
