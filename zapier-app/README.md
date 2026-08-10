# Private Zapier-App: MATOOL Middleware

Diese interne Zapier-Platform-CLI-App liest neue oder geänderte Datensätze aus
dem MATOOL Middleware Hub. Sie enthält genau einen Polling-Trigger:

`Neuer oder geänderter MATOOL-Datensatz`

Die App nimmt keinen Kontakt zu Interessenten oder Mitgliedern auf, versendet
keine Nachrichten und verändert keine Daten in MATOOL. Zeitregeln und spätere
Zapier-Folgeaktionen werden ausschließlich vom Benutzer im jeweiligen Zap
eingerichtet.

## Verbindung

Die Middleware-Adresse wird vor dem Upload als App-Umgebungswert
`MATOOL_MIDDLEWARE_ORIGIN` festgelegt. Mitarbeitende können die Zieladresse in
Zapier nicht ändern. Jede Anfrage wird auf diese HTTPS-Origin begrenzt und mit
genau einem `Middleware Service-Token` authentifiziert. MATOOL-Zugangsdaten
werden niemals in Zapier gespeichert.

## Trigger

Im Zap wird ein gespeicherter MATOOL-Bereich ausgewählt. Zapier ruft höchstens
100 Datensätze pro Poll ab. Eine stabile technische ID aus Bereich,
MATOOL-Quell-ID und Inhaltshash sorgt dafür, dass unveränderte Datensätze nicht
erneut auslösen und echte Änderungen als neuer Vorgang erkannt werden.

`Interessenten-Details` stellt zusätzlich alle 34 lesend erfassten Detailfelder
für das Zapier-Mapping bereit. Die hinterlegten Beispieldaten sind vollständig
synthetisch.

## Lokale Prüfung

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run validate:offline
```

## Privater Upload

Für Registrierung und Upload werden eine authentifizierte Zapier-CLI-Sitzung
und die endgültige Staging-Origin benötigt:

```text
zapier-platform login
zapier-platform register "KwonRo MATOOL Middleware"
pnpm run zapier:build
zapier-platform push
zapier-platform env:set 0.0.0 MATOOL_MIDDLEWARE_ORIGIN=https://<staging-hostname>
```

Produktive Tokens gehören ausschließlich in die Zapier-Verbindung und in
Cloudflare-Secrets, niemals in `.env`, Git, Chat oder Ausgaben.
