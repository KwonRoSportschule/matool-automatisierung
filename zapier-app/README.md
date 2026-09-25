# Private Zapier-App: MATOOL Middleware

Diese interne Zapier-Platform-CLI-App liest neue oder geänderte Datensätze aus
dem MATOOL Middleware Hub. Sie enthält einen generischen und fünf klar
benannte REST-Hook-Trigger:

- `Neuer oder geänderter MATOOL-Datensatz` (Bereich auswählbar)
- `Neuer oder geänderter MATOOL-Interessent`
- `Neues oder geändertes MATOOL-Mitglied`
- `MATOOL-Mitglied ausgeschieden`
- `Neuer MATOOL-Check-in`
- `Neue oder geänderte MATOOL-Prüfung`

Dazu kommt eine lesende Aktion:

- `Beitragsübersicht erstellen`: Monatssumme aller nicht stillgelegten
  Mitglieder plus XML-Datei, siehe
  [docs/beitraege-zapier.md](../docs/beitraege-zapier.md)

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

Alle Trigger verwenden REST Hooks mit dynamischer An- und Abmeldung. Der
generische Trigger erlaubt nur tatsächlich und datenschutzgerecht in der
Middleware gespeicherte Bereiche: Interessenten, Interessenten-Details,
Mitglieder-Stammdaten, minimierte Mitglieder-Details, abgeschlossene
Kündigungen (Ex-Mitglieder), Check-ins sowie Prüfungen/Graduierungen. Eine stabile
technische Ereignis-ID sorgt dafür, dass unveränderte Datensätze nicht erneut
auslösen und echte Änderungen als neuer Vorgang erkannt werden.

`Interessenten-Details` stellt zusätzlich alle 34 lesend erfassten Detailfelder
für das Zapier-Mapping bereit. Mitglieder-Details werden serverseitig auf eine
minimierte Auswahl von Kontakt-, Vertrags-, Klassen- und Statusfeldern
reduziert; Bank-, Konto-, Mandats- und Zahlungsdaten werden nicht an Zapier
ausgeliefert. Check-ins liefern ausschließlich Mitglieds- und Klassen-ID
sowie Zeitpunkt. Prüfungen liefern Mitglieds- und Graduierungs-ID, Datum,
Grad/Sparte, PDF-Hinweis und Storno-Status. Die hinterlegten Beispieldaten
sind vollständig synthetisch.

Für die Trigger kann zusätzlich **Nur neue Datensätze** gewählt werden. Dann
läuft der Zap ausschließlich beim erstmaligen Erscheinen eines Datensatzes
(beim Mitglieder-Trigger also nur bei neuen Mitgliedern), nie bei späteren
Änderungen.

## Lokale Prüfung

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run validate:offline
```

## Privater Upload

Regulär lädt der GitHub-Workflow „Zapier-App veröffentlichen“
(`.github/workflows/zapier-app.yml`) die App nach jedem Merge nach `main`
hoch, der `zapier-app/` ändert. Er braucht das Repository-Secret
`ZAPIER_DEPLOY_KEY` (Zapier Developer Platform → Settings → Deploy Keys) und
setzt für eine neue Version `MATOOL_MIDDLEWARE_ORIGIN`, falls der Wert fehlt.

Jede Änderung bekommt eine neue Versionsnummer in `package.json`. Die
neue Version ist danach hochgeladen, aber noch nicht freigeschaltet: In der
Zapier Developer Platform unter „Versions“ auf „Promote“ klicken und bei
Bedarf bestehende Zaps per „Migrate“ nachziehen. Ältere Versionen bleiben
unverändert, bis sie migriert werden.

Manuell:

Für Registrierung und Upload werden eine authentifizierte Zapier-CLI-Sitzung
und die endgültige Staging-Origin benötigt:

```text
zapier-platform login
zapier-platform register "KwonRo MATOOL Middleware"
pnpm run zapier:build
zapier-platform push
zapier-platform env:set <version> MATOOL_MIDDLEWARE_ORIGIN=https://<staging-hostname>
```

Produktive Tokens gehören ausschließlich in die Zapier-Verbindung und in
Cloudflare-Secrets, niemals in `.env`, Git, Chat oder Ausgaben.
