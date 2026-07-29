# Private Zapier-App: MATOOL Middleware

Diese interne Zapier-Platform-CLI-App verbindet genau einen aktiven
Probetraining-Trigger mit der Cloudflare-Middleware.

## Sicherheitsablauf

1. Zapier registriert beim Aktivieren des Zaps einen REST Hook.
2. Die Middleware sendet nur `event_id`, `delivery_id`, ein kurzlebiges
   `delivery_token` und den Ereignistyp.
3. Die App prüft die HMAC-Signatur des unveränderten Hook-Bodys.
4. Ein atomarer Claim gibt genau einmal die minimal benötigten Kontaktdaten
   frei.
5. Der letzte Zap-Schritt meldet Erfolg oder Fehler mit der `claim_id`.

MATOOL-Zugangsdaten werden niemals in Zapier gespeichert.
Die Middleware-Origin wird nicht von Mitarbeitenden in einer Verbindung
eingegeben, sondern vor dem Upload als App-Umgebungswert
`MATOOL_MIDDLEWARE_ORIGIN` fest angeheftet. Die App verweigert jede
Weitergabe ihrer Zugangsdaten an eine andere Origin.

## Lokale Befehle

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run validate
```

Für Registrierung und Upload werden später eine authentifizierte
Zapier-Platform-CLI-Sitzung sowie ein Deploy Key benötigt:

```text
zapier-platform login
zapier-platform register
zapier-platform push
```

Vor dem ersten Kontotest wird `MATOOL_MIDDLEWARE_ORIGIN` auf die endgültige
HTTPS-Origin des geschützten Cloudflare-Workers gesetzt. Staging und Produktion
verwenden getrennte App-Versionen beziehungsweise getrennt festgelegte Origins.

Das vom Sample-Endpunkt gelieferte Beispiel dient nur dem Feld-Mapping im
Zap-Editor. Seine syntaktisch gültige Claim-ID steht nicht als echter Claim in
D1. Die Aktion „Kontakt-Ergebnis melden“ wird deshalb erst mit einem zuvor von
der Middleware erzeugten synthetischen Testereignis geprüft; `not_claimable`
wird bewusst als fehlgeschlagener Zap-Schritt behandelt.

Produktive Tokens gehören ausschließlich in die Zapier-Verbindung und in
Cloudflare-Secrets, niemals in `.env`, Git oder Ausgaben.
