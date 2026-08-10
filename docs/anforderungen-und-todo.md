# Anforderungen und Todo-Plan

Stand: 3. August 2026

## Wofuer die Anwendung da ist

Die Anwendung ist der Daten-Mittelmann zwischen MATOOL und Zapier. Sie liest
Daten aus MATOOL, speichert sie in einer eigenen Cloudflare-Datenbank und
stellt sie fuer die Webseite und Zapier bereit.

Die Anwendung kontaktiert keine Interessenten oder Mitglieder. Nachrichten,
Zeitregeln und weitere Aktionen werden spaeter ausschliesslich in Zapier
eingerichtet.

## Bestaetigte Anforderungen

- MATOOL wird nur gelesen. Die Anwendung darf dort nichts aendern.
- Neue und geaenderte Daten werden in einer Datenbank ausserhalb von MATOOL
  gespeichert.
- Der automatische Abruf laeuft montags bis freitags jede volle Stunde von
  09:00 bis 19:00 Uhr. Feiertage werden ausgelassen.
- Interessenten, Mitglieder und alle weiteren sinnvoll lesbaren Bereiche
  sollen uebernommen werden.
- Fuer die noch fehlenden beziehungsweise aufwendigeren Bereiche wird ein
  kostenpflichtiger Cloudflare-Tarif eingeplant.
- Die aktuelle Test-Webseite soll die gespeicherten Daten im Klartext und ohne
  Anmeldung anzeigen koennen.
- Zapier soll die gespeicherten Daten abholen koennen. Die Anwendung selbst
  verschickt keine Nachrichten und startet keine Kontaktaufnahme.
- Fehler und die Zahl der gelesenen Daten muessen auf der Webseite erkennbar
  sein.
- Wenn fuer eine Aufgabe Informationen, Aufnahmen oder Freigaben fehlen, fragt
  Codex zuerst den Benutzer. Codex darf fehlende Angaben nicht erraten und
  nicht selbststaendig aus MATOOL oder einem anderen Dienst beschaffen.

## Wichtige Freigabe fuer die Klartextansicht

Die Anforderung **Klartext ohne Anmeldung** ist aufgenommen, aber noch nicht
fuer echte Personendaten freigegeben. Ohne Anmeldung kann jeder mit dem Link
Namen, Kontaktdaten und andere sichtbare Werte lesen.

Die Klartextansicht wird deshalb erst eingeschaltet, wenn entweder nur
Testdaten verwendet werden oder schriftlich festgelegt wurde, welche echten
Daten oeffentlich gezeigt werden duerfen. Bis dahin bleibt die Webseite
oeffentlich erreichbar, zeigt die einzelnen Werte aber verdeckt an.

## Einfacher Todo-Plan

### 1. Cloudflare erweitern

- [ ] Kostenpflichtigen Cloudflare-Tarif buchen.
- [ ] Danach pruefen, ob die stuendlichen Laeufe genug Zeit fuer alle Bereiche
      haben.

### 2. Oeffentliche Klartextansicht festlegen

- [ ] Festlegen, ob die Daten Testdaten oder echte Personendaten sind.
- [ ] Festlegen, welche Felder ohne Anmeldung sichtbar sein duerfen.
- [ ] Die Freigabe fuer diese Felder schriftlich festhalten.
- [ ] Erst danach die Klartextanzeige auf der Test-Webseite einschalten.

### 3. Fehlende MATOOL-Bereiche fertigstellen

- [x] Einen neuen MATOOL-Mitschnitt bereitstellen, in dem der Bereich Klassen
      geoeffnet und eine Klasse angezeigt wird.
- [ ] Berichte anschliessen und pruefen.
- [x] Klassen anschliessen und pruefen.
- [ ] Telemetrie anschliessen und pruefen.
- [ ] Fuer jeden Bereich kontrollieren, ob Anzahl und Inhalt zu MATOOL passen.

### 4. Automatische Laeufe pruefen

- [ ] Einen ganzen Arbeitstag beobachten.
- [ ] Kontrollieren, dass jeder Lauf zwischen 09:00 und 19:00 Uhr startet.
- [ ] Kontrollieren, dass neue oder geaenderte Daten in der Datenbank landen.
- [ ] Bei einem Fehler eine gut sichtbare Meldung auf der Webseite zeigen.

### 5. Zapier fertig verbinden

- [ ] Zapier-Zugang einrichten.
- [ ] Einen Testabruf ohne Kontaktaufnahme durchfuehren.
- [ ] Pruefen, dass Zapier nur neue oder geaenderte Daten erhaelt.
- [ ] Nachrichten und Kontakte weiterhin ausgeschaltet lassen, bis sie spaeter
      bewusst in Zapier gebaut werden.

### 6. Projekt sichern

- [ ] Offene Aenderungen pruefen.
- [ ] Den fertigen Stand zu GitHub hochladen.
- [ ] Spaeter eine getrennte Produktionsversion einrichten.

## Bereits erledigt

- [x] Cloudflare-Test-Webseite ist erreichbar.
- [x] Eigene Cloudflare-Datenbank ist vorhanden.
- [x] Stuendlicher Abruf ist eingerichtet.
- [x] MATOOL-Verbindung funktioniert.
- [x] Daten aus neun Bereichen sind bereits gespeichert.
- [x] Der Klassenbereich liest 43 Klassen vollstaendig und speichert sie mit
      stabilen MATOOL-IDs.
- [x] Datenansicht auf der Webseite ist vorhanden und aktuell noch verdeckt.
- [x] Zapier-Abholschnittstelle ist vorbereitet.
- [x] Die Anwendung nimmt keinen Kontakt zu Interessenten oder Mitgliedern auf.
