# Pilotspezifikation: Verlängerung nach GLZ

Status: Fachlicher Entwurf  
Stand: 29. Juli 2026

## 1. Ziel

Mitgliedschaften werden 42 Kalendertage vor dem Ende ihrer Grundlaufzeit
erkannt. Der Pilot erzeugt zunächst nur ein internes, dedupliziertes
Shadow-Ereignis. Er sendet keine E-Mail und verändert MATOOL nicht.

Der Entwurf bildet die nachgewiesene Logik des bestehenden Zapier-Ablaufs ab,
reduziert aber die verarbeiteten Personendaten.

## 2. Belegte Altlogik

| Befund | Quellartefakt |
|---|---|
| täglicher Schedule und MATOOL-Aktion „Upcoming Membership Renewals“ | `KwonRo Zap Dokumentation MATool.pdf`, Seiten 1–2 |
| `Reference Days = 42` | `KwonRo Zap Dokumentation MATool.pdf`, Seite 2 |
| Line-Item-Verarbeitung und maximal 500 Loop-Iterationen | `KwonRo Zap Dokumentation MATool.pdf`, Seite 3 |
| Felder Name, E-Mail, Vertragsbeginn/-ende, Gebühr und Geburtsdatum im Altprozess | `KwonRo Zap Dokumentation MATool.pdf`, Seite 3 |
| Filter auf vorhandene E-Mail und Vertragsstart nach dem 1. Januar 2026 | `KwonRo Zap Dokumentation MATool.pdf`, Seite 4 |
| E-Mail, Google-Sheets-Status `Offen`, Jotform-Rückkanal und 7-bis-14-Tage-Nachfassreport | `Notizen zur automatisierten Verlängerung nach GLZ.docx` |

Die 500er-Grenze ist eine Grenze des dokumentierten Zapier-Loops, keine belegte
Grenze von MATOOL. Die Altunterlagen belegen die Fachabsicht; Selektoren,
MATOOL-Feldnamen und eine stabile Vertragsperioden-ID sind darin nicht
nachgewiesen.

## 3. Pilotumfang

### Enthalten

- MATOOL-Login und read-only Abruf;
- Kandidatenermittlung für einen fachlichen Stichtag;
- Feldvalidierung;
- stabile Quellschlüssel und Hashes;
- Baseline- und Shadow-Modus;
- D1-Speicherung;
- Anzeige von Lauf- und Ereignismengen im Adminbereich.

### Nicht enthalten

- produktiver E-Mail-Versand;
- automatische Vertragsänderung in MATOOL;
- öffentliche Verlängerungsseite;
- Übertragung von Bankdaten;
- öffentlich freigegebene Google-Tabelle;
- produktiver Zapier-Trigger;
- automatischer Nachfassreport.

## 4. Fachlicher Stichtag

Die Regel verwendet das lokale Kalenderdatum in `Europe/Berlin`:

```text
contract_end_date = local_today + 42 Kalendertage
```

Es wird nicht mit `42 * 24 Stunden` auf UTC-Zeitstempeln gerechnet. Dadurch
entsteht bei Sommer-/Winterzeit kein Tagesversatz.

Noch zu bestätigen:

- Verhalten an Wochenenden und Feiertagen;
- ob ein ausgefallener Lauf Kandidaten der Vortage nachholt;
- ob Vertragsstart **nach** oder **ab einschließlich** 1. Januar 2026 gilt;
- welches konkrete MATOOL-Feld das Ende der Grundlaufzeit bezeichnet;
- ob die historische Startgrenze dauerhaft gelten soll;
- welche Syntax und Normalisierung eine gültige E-Mail definiert.

Empfohlene Ausfallsicherheit: ein kontrolliertes Lookback-Fenster, wobei eine
eindeutige `event_id` Mehrfachaktionen verhindert.

## 5. Daten-Whitelist

### Für den Shadow-Pilot erforderlich

| Feld | Zweck | Speicherung |
|---|---|---|
| stabile Mitgliedschafts- oder Vertrags-ID | Deduplizierung | erforderlich |
| Vertragsbeginn | Filter | erforderlich |
| Vertragsende | Stichtag und Ereignis | erforderlich |
| E-Mail vorhanden/gültig | Eignungsprüfung | als boolesches Ergebnis ausreichend |
| Standort/Sektor | fachliche Zuordnung | nur wenn bestätigt |

### Erst für eine freigegebene Zustellung

| Feld | Zweck |
|---|---|
| Vorname und Nachname | Personalisierung |
| E-Mail-Adresse | Empfänger |
| aktuelle Gebühr | Verlängerungsangebot |
| aktuelle Laufzeit | Verlängerungsangebot |
| Klasse/Tarif | zulässige Verlängerungsoptionen |
| Telefonnummer | ausschließlich freigegebene Nachfassung |

### Standardmäßig ausgeschlossen

- Geburtsdatum;
- Anschrift;
- Fotos;
- Bankverbindung und IBAN;
- Freitextnotizen;
- Gesundheits- oder Trainingsdaten;
- Roh-HTML;
- nicht benötigte MATOOL-IDs.

Das Geburtsdatum war Teil des alten Links. Im neuen Ablauf darf es weder in der
URL noch ohne gesonderte fachliche Begründung im Ereignis stehen.

## 6. Schlüssel, Vertragsperiode und Hashes

Stabiler Datensatzschlüssel:

```text
matool:membership:{membership_id}
```

Stabile Geschäftsperiode, in bevorzugter Reihenfolge:

```text
matool:contract-period:{contract_period_id}
matool:contract:{contract_id}
```

`contract_end_date` gehört nicht in den Datensatzschlüssel, weil eine Korrektur
sonst einen neuen Datensatz erzeugen würde. Für ein wiederkehrendes
Verlängerungsereignis wird zusätzlich eine unveränderliche Vertragsperioden-ID
benötigt. Eine bloß aus Name, E-Mail oder einem veränderlichen Datum gebildete
ID ist für Produktion nicht zulässig.

Falls MATOOL weder eine stabile Mitgliedschafts- noch Vertragsperioden-ID
liefert, stoppt das Pilot-Gate. Vor einer produktiven Alternative muss dann ein
fachlich stabiler Identifikator nachgewiesen werden.

Normalisierter Hash:

```text
sha256(schema_version + canonical_json(whitelisted_fields))
```

Ereignis-ID:

```text
sha256(
  contract_period_key
  + event_type
)
```

`event_schema_version`, Payload-Version und normalisierter Hash werden separat
gespeichert und verändern die fachliche `event_id` nicht. Eine Korrektur von
Vertragsende oder Payload aktualisiert ein noch nicht bestätigtes Ereignis,
erzeugt aber keine zweite fachliche Kundenaktion. Eine Korrektur nach
bestätigter Aktion wird als Konflikt sichtbar und benötigt eine explizite
manuelle Entscheidung.

## 7. Zustandsmodell

Datensatzstatus:

| Status | Bedeutung |
|---|---|
| `baseline` | gesehen, aber keine Aktion erlaubt |
| `candidate` | technische und fachliche Kandidatenregeln erfüllt |
| `excluded` | gültiger Datensatz, aber fachliche Ausschlussregel greift |

Ereignisstatus:

| Status | Bedeutung |
|---|---|
| `shadow_ready` | fachlich prüfbares Testereignis |
| `approved` | manuell für Testzustellung freigegeben |
| `queued` | in der Outbox |
| `transport_accepted` | Zapier beziehungsweise der Sink hat HTTP-seitig angenommen |
| `action_confirmed` | deduplizierte Zielaktion wurde ausdrücklich bestätigt |
| `renewed` | fachlicher Rückkanal bestätigt Verlängerung |
| `follow_up_due` | bestätigte Aktion liegt im Nachfassfenster |
| `failed` | Ereignis ist nach dauerhafter Prüfung nicht ausführbar |

Zustellstatus:

| Status | Bedeutung |
|---|---|
| `pending` | noch nicht versucht |
| `in_flight` | aktiver Versuch mit Lease/Fencing-Token |
| `retry_wait` | vorübergehender Fehler, wartet auf Backoff |
| `accepted` | Transportempfänger hat angenommen |
| `permanent_failure` | keine automatische Wiederholung |

Der produktive Übergang zu `approved` bleibt bis zur fachlichen Abnahme
deaktiviert. `transport_accepted` bedeutet ausdrücklich nicht, dass eine
Kundenmail tatsächlich versendet oder gelesen wurde.

## 8. Ausschlüsse

Gültige datensatzbezogene Ausschlüsse:

- fehlende beziehungsweise ungültige E-Mail für eine spätere Zustellung;
- Vertragsbeginn liegt außerhalb der bestätigten Startregel;
- Vertragsende liegt außerhalb des fachlichen Stichtags;
- bestätigte fachliche Ausschlussregel.

Lauffatale technische Fehler:

- keine stabile ID oder Vertragsperioden-ID;
- ungültiges oder fehlendes Pflichtdatum;
- Loginseite mit HTTP 200 anstelle authentifizierter Daten;
- unerwartetes Antwortschema;
- leere, abgeschnittene oder erkennbar unvollständige Antwort;
- unvollständige Pagination;
- widersprüchliche doppelte Zeilen.

Ein lauffataler Fehler setzt keine Datensätze auf `excluded`. Der gesamte
Collector-Lauf schlägt fehl und schreibt weder Records, Event-Hashes noch
Watermark fort. Ein strukturell gültiges, ausdrücklich als vollständig
erkanntes Null-Ergebnis ist davon zu unterscheiden.

Fachliche Ausschlüsse sind vor Produktion festzulegen, insbesondere:

- bereits verlängert;
- gekündigt oder archiviert;
- bekannte Sonder- beziehungsweise Familienvereinbarung;
- stille Zahler oder andere Gruppen ohne Kontaktfreigabe;
- laufender manueller Klärungsfall;
- falscher Standort oder Tarif.

## 9. Baseline und Lookback

Erster realer Lauf:

1. Datensätze abrufen und validieren.
2. `records` und technische Mengen speichern.
3. keine Outbox-Einträge erzeugen.
4. Ergebnisse manuell mit MATOOL vergleichen.

Erst ein ausdrücklich freigegebener Shadow-Lauf darf `shadow_ready`-Ereignisse
erzeugen. Produktive Ereignisse bleiben weiterhin gesperrt.

## 10. Abnahmekriterien

### Parser

- gleicher Input erzeugt denselben Schlüssel und Hash;
- deutsches Datum und Dezimalformat werden eindeutig normalisiert;
- leere, verkürzte und strukturell veränderte Antworten schlagen fehl;
- gültiges Null-Ergebnis wird von leerer oder abgeschnittener Antwort
  unterschieden;
- Pagination, erkennbare Trunkierung und mehr als 500 Treffer sind getestet;
- doppelte Zeilen mit gleichem Schlüssel werden erkannt;
- Monats- und Jahreswechsel sowie Schaltjahr sind getestet;
- kein reales Personenmerkmal in Fixtures oder Snapshots.

### Synchronisation

- im Normalfall genau ein Login pro Lauf; höchstens eine begrenzte, erkannte
  Re-Authentifizierung bei Sessionablauf;
- alle Collector-Requests verwenden dieselbe laufbezogene Session;
- eine Loginseite mit HTTP 200 wird nicht als fachliche Nullmenge akzeptiert;
- zweiter unveränderter Lauf erzeugt null neue Ereignisse;
- eine bekannte relevante Änderung erzeugt genau eine neue Version;
- eine Vertragsendkorrektur erzeugt keine zweite Kundenaktion;
- ein Fehler aktualisiert weder Watermark noch erfolgreichen Hash;
- überlappender manueller und geplanter Lauf wird verhindert;
- verlorener 2xx-Response, Timeout und Retry bleiben durch dauerhafte
  Ziel-Deduplizierung ohne zweite Nebenwirkung.

### Fachlichkeit

- Kandidatenmenge stimmt für mindestens zehn Läufe mit MATOOL überein;
- der Vergleich stimmt zusätzlich auf Ebene der stabilen Datensatzschlüssel;
- ein Fall genau 42 Tage vor Vertragsende wird erkannt;
- Fälle 41 und 43 Tage vor Vertragsende werden nicht als Tageskandidat erkannt;
- Vertragsstartgrenze ist eindeutig getestet;
- Wochenend-, Feiertags- und Lookback-Verhalten ist bestätigt und getestet;
- Ausschlüsse werden einzeln getestet;
- Baseline erzeugt keine Kundenaktion.

### Datenschutz

- keine Personendaten in URLs oder Logs;
- Adminansicht maskiert Werte;
- Antworten mit Personendaten sind nicht cachebar;
- Aufbewahrungs- und Löschfristen sind vor Produktion konfiguriert und getestet.

## 11. Offene fachliche Punkte

1. Welche Verlängerungsoptionen gelten je Klasse, Tarif und Standort?
2. Soll die bestehende Jotform-Lösung bleiben oder später durch eine eigene
   öffentliche Seite ersetzt werden?
3. Wie wird eine bereits vor Ort oder telefonisch erfolgte Verlängerung erkannt?
4. Welche Gruppen dürfen nicht automatisch kontaktiert werden?
5. Wie lange bleiben offene, verlängerte und fehlgeschlagene Vorgänge gespeichert?
6. Soll der wöchentliche 7-bis-14-Tage-Report Bestandteil dieser Anwendung
   werden?
