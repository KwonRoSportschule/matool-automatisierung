# Sanitisierte HAR-Analyse

Quelle: `matool-master.har`  
Aufzeichnung: 28. Juli 2026  
Analyse: 29. Juli 2026

## 1. Schutzbedarf

Die Originaldatei enthält nicht leere Loginwerte, interne Kennungen,
Personenfotos und einen von MATOOL ausgelieferten Google-Maps-Schlüssel. Sie ist
kein Repository-Artefakt und wird nicht kopiert.

Diese Dokumentation enthält ausschließlich Struktur, Parameternamen und
redigierte technische Befunde.

## 2. Umfang

- 841 Requests insgesamt;
- 792 Requests an `core.matool.de`;
- 826 GET, 14 POST, 1 OPTIONS;
- 14 aufgezeichnete Seitennavigationen nach dem Login;
- aufgezeichnete Requests und Ressourcen sprechen für eine überwiegend
  servergerenderte PHP-Anwendung über HTTPS/HTTP2;
- dynamische Antworten überwiegend als `text/html; charset=UTF-8`;
- in dieser Aufzeichnung keine öffentliche REST- oder GraphQL-API erkennbar;
- keine WebSockets.

Beobachteter MATOOL-Rate-Limit-Header:

```text
limit: 1000
remaining: 963 bis 999 während der Aufzeichnung
```

Zeitraum und Geltungsbereich dieses Limits sind nicht belegt.

## 3. Loginbefund

Beobachtet:

```text
POST /index.php
Content-Type: application/x-www-form-urlencoded
Felder: mail, pass
Antwort: 302, relatives Ziel /index.php
danach: GET /index.php; im Browser wurde eine angemeldete Oberfläche gesehen
```

Nicht belegt:

- vorgeschaltetes `GET /index.php` zum Aufbau einer Session;
- Cookie-Name und Cookie-Attribute;
- `Set-Cookie`-Antworten und `Cookie`-Request-Header;
- Sessionlaufzeit und Ablaufverhalten;
- eindeutiger HTML-Marker für einen erfolgreichen Login;
- Verhalten bei falschem Passwort, Logout oder abgelaufener Session.

Die fehlenden Cookieinformationen sind wahrscheinlich eine Eigenschaft des
Browserexports. Sie beweisen nicht, dass MATOOL ohne Cookies arbeitet.
Die sichtbare Oberfläche ist noch kein maschinenprüfbarer Loginnachweis; dafür
wird ein stabiler authentifizierter Marker benötigt.

## 4. CSRF und Browserkonventionen

In den aufgezeichneten Parametern ist kein CSRF-, XSRF- oder Nonce-Feld
sichtbar. Die meisten fachlichen HTML-Bodies fehlen jedoch, daher ist das kein
Beweis für fehlenden CSRF-Schutz.

XHR-Aufrufe verwenden:

```text
Origin
Referer
X-Requested-With: XMLHttpRequest
```

Normale Formular-POSTs verwenden `Origin` und `Referer`.

## 5. Beobachtete Module

```text
interessenten
schueler
checkin
telemetrie
artikel
lager
newsletter
pruefungen
klassen
karte
archiv
berichte
```

Zusätzlich sind mehrere Standorte, Kassenfunktionen und weitere
Navigationsbereiche erkennbar.

## 6. Beobachtete dynamische Requests

| Zweck | Methode und Pfad | Parameter |
|---|---|---|
| Login | `POST /index.php` | `mail`, `pass` |
| Modulnavigation | `GET /index.php` | `show` |
| Interessent öffnen | `POST /json/session_interessenten_open.php` | `interessenten_open`, `todo=open` |
| Interessentenstatistik | `POST /json/statistik_daten.php` | `id` |
| Schüler öffnen | `POST /json/session_schueler_open.php` | `schueler_open`, `todo=open` |
| Schülerdetail | `POST /json/schueler_daten.php` | `id`, `todo` |
| Check-in-Zeitraum | `POST /json/checkin_zeitraum.php` | `datum` |
| Telemetrie | `POST /json/telemetrie_data.php` | `show`, `id` |
| Artikel öffnen | `POST /json/session_artikel_open.php` | `artikel_open`, `todo=open` |
| Artikeldetail | `POST /json/artikel_daten.php` | `id` |
| Klassendaten | `POST /json/klassen_daten.php` | `todo=daten`, `id` |
| Bericht erzeugen | `POST /json/berichte_erzeugen_pdf.php` | Berichtstyp und Zeitraum |
| Standortwechsel | im JavaScript referenziert | `id` |

Die `session_*`-Endpunkte antworten leer. Name und zeitliche Abfolge legen eine
Änderung von Sessionzustand nahe; dies ist im PoC zu verifizieren. Bis dahin
dürfen zwei Abläufe nicht unkoordiniert dieselbe Session teilen.

## 7. Antwort- und Parsergrenzen

Die HAR enthält Größenmetadaten, aber fast keine fachlich wichtigen
Response-Bodies:

- Interessentenseite ungefähr 0,8 MB;
- Schülerseite ungefähr 1,0 MB;
- keine gespeicherten Tabellenzeilen oder Detailantworten;
- keine verlässlichen CSS-Selektoren;
- keine sichtbaren Pflichtfelder oder Fehlermeldungen.

Pagination-Grafiken werden geladen, jedoch wurden keine Parameter wie `page`,
`offset`, `limit` oder `search` beobachtet. Möglich ist eine vollständige Liste
mit clientseitiger Pagination; dies ist nicht bestätigt.

## 8. Was vor einem Collector nachgewiesen werden muss

| Nachweis | Aktueller Status |
|---|---|
| Login per Worker-`fetch` | offen |
| CookieJar mit echtem Cookie-Namen | offen |
| stabiler Loginmarker | offen |
| GLZ-Listenrequest | nicht in HAR isoliert |
| vollständige GLZ-Response | fehlt |
| Tabellen- und Feldselektoren | fehlen |
| stabile Mitgliedschafts-ID | offen |
| leeres Ergebnis | fehlt |
| Fehlerantwort | fehlt |
| Pagination/Filter | offen |
| Standortwechsel | nur referenziert |
| CPU-Zeit beim Parser | ungemessen |

## 9. Nächster technischer Beleg

Priorität:

1. Quellcode der vorhandenen privaten Zapier-MATOOL-Integration beschaffen.
2. Falls nicht verfügbar, einen lokalen read-only Probe-Client implementieren.
3. Der Probe-Client protokolliert nur:
   - Cookie-Namen, niemals Werte;
   - Status und Redirectpfad;
   - HTML-Größe;
   - Formular-, Tabellen- und Feldnamen;
   - anonymisierte Mengen und Struktur-Hashes.
4. Erst danach eine vollständig synthetische Parser-Fixture erstellen.

Ein weiterer unredigierter HAR-Upload ist nicht der bevorzugte Weg.
