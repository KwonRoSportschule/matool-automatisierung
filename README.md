# MATOOL Middleware Hub

Cloudflare-Worker-Grundlage für die geplante, datensparsame MATOOL-Synchronisation.

## Aktueller Stand

- Fester UTC-Cron `0 6-19 * * MON-FRI` mit vorgeschaltetem Zeitfenster in `Europe/Berlin`.
- Ein gemeinsamer Login pro Lauf über `fetch`, `PHPSESSID` und eine eigene CookieJar.
- Neutrale Collector-Ausführung; produktive Collectors bleiben deaktiviert, bis echte Requests, Antwortformate, Pflichtfelder und Vollständigkeitsgrenzen verifiziert sind.
- Keine HAR-Dateien, Secrets, Cookies oder Echtdaten im Repository.

Der vorhandene Wochenlauf war in diesem initial leeren Repository nicht vorhanden und wurde daher weder verändert noch ersetzt. Die vom Nutzer genannte lokale HAR-Datei war im Container nicht verfügbar. Schreibende oder zustandsverändernde Requests werden nicht geraten oder ausgeführt.

## Lokal prüfen

```sh
npm test
npm run check
```

Vor einem Deployment müssen die KV-IDs in `wrangler.toml` gesetzt und `MATOOL_MAIL` sowie `MATOOL_PASS` als Cloudflare-Secrets hinterlegt werden. Der Worker führt derzeit bewusst noch keinen Collector und keine KV- oder Google-Schreiboperation aus.
