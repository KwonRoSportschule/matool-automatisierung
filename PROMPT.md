# Umsetzungs-Prompt: MATOOL-Automatisierung und KwonRo-Dashboard

## Rolle und Projektziel

Du bist Senior Cloud-Architekt:in, UX/UI-Designer:in und Full-Stack-Entwickler:in. Plane und implementiere eine sichere, wartbare Middleware-Webanwendung für **KwonRo – Die Kampfsportschule**.

Die Anwendung soll:

1. Daten aus **MATOOL ohne offizielle API** anhand der bereitgestellten HAR- und MD-Dateien auslesen,
2. die Daten in **Google Sheets** als leicht administrierbare Datenbank speichern,
3. alle freigegebenen Daten in einem responsiven, markenkonformen Web-Dashboard anzeigen und verwalten,
4. neue oder geänderte Datensätze an **Zapier** übergeben,
5. den Scraper automatisiert mit **GitHub Actions** ausführen und
6. das Frontend automatisch über **Cloudflare Pages** bereitstellen.

Arbeite produktionsnah. Erfinde keine MATOOL-Endpunkte oder Feldnamen. Wenn Informationen in den Anhängen fehlen, dokumentiere die offene Frage und verwende klar gekennzeichnete Platzhalter.

---

## Verbindlicher Tech-Stack und Datenfluss

```text
[ MATOOL ]
    │ HTTPS / authentifizierte Requests
    │ Scraping durch Python in GitHub Actions
    ▼
[ Google Apps Script Web-App ]
    │ validiert, normalisiert und schreibt Daten
    ▼
[ Google-Sheets-Arbeitsmappe ] ─────► [ Zapier ]
    │                                  Trigger bei neuen/geänderten Zeilen
    │ nur freigegebene Daten als JSON
    ▼
[ Cloudflare Pages ]
    └── responsives KwonRo-Dashboard aus dem GitHub-Repository
```

### Randbedingungen

- Bevorzugt wird eine **Google-Apps-Script-Web-App**, damit keine umfangreiche Einrichtung in der Google Cloud Console erforderlich ist.
- Falls ein Service Account zwingend nötig ist, begründe dies und dokumentiere ihn nur als optionale Alternative.
- Zugangsdaten, Cookies, Tokens und personenbezogene Daten dürfen niemals in Git, Build-Logs oder dem öffentlichen Frontend erscheinen.
- Secrets liegen ausschließlich in **GitHub Actions Secrets**, **Cloudflare Secrets/Environment Variables** oder den **Script Properties** von Apps Script.
- Das Frontend darf eine Google-Tabelle nicht ungeschützt veröffentlichen. Lesezugriffe erfolgen über einen abgesicherten, datensparsamen Endpunkt.
- Beachte DSGVO-Grundsätze: Datenminimierung, Zweckbindung, Rollen/Rechte, Löschkonzept, Protokollierung und konfigurierbare Aufbewahrungsfristen.

---

## Vorhandene Unterlagen

Analysiere vor der Implementierung vollständig:

1. **MD-Datei:** Dokumentation des früheren Scraping-Projekts als methodische Referenz.
2. **HAR-Datei:** Netzwerkverkehr aus MATOOL mit Requests, Endpunkten, Methoden, Headern, Cookies und Payloads.
3. **Schemagrafiken:** Vorgaben für Datenstruktur, Prozesse und Datenfluss.
4. **Designreferenzen:** Screenshots, bestehende KwonRo-Webseite und gegebenenfalls die genannte Liga-/Hausstudio-Referenz.

Behandle die HAR-Datei als geheim, da sie aktive Sitzungsdaten enthalten kann. Übernimm nur technisch erforderliche Muster; speichere keine echten Tokens oder Cookies im Repository. Prüfe außerdem, ob Scraping laut Nutzungsbedingungen, Berechtigungen und Datenschutzvorgaben zulässig ist.

---

## Google Sheets als Datenbank

Erstelle eine Arbeitsmappe mit mehreren logisch getrennten Tabellenblättern. Verwende unveränderliche technische IDs, ISO-8601-Zeitstempel und eine `source_updated_at`-Spalte, damit Datensätze zuverlässig per **Upsert** statt als Duplikate gespeichert werden.

### Pflicht-Tabellenblätter

| Tabellenblatt | Zweck | Beispielspalten |
| --- | --- | --- |
| `Interessenten` | Leads und Probetrainings | `id`, `vorname`, `nachname`, `email`, `telefon`, `standort_id`, `programm`, `status`, `quelle`, `probetraining_am`, `created_at`, `source_updated_at`, `synced_at` |
| `Mitglieder` | Aktive und ehemalige Mitglieder | `id`, `mitgliedsnummer`, `vorname`, `nachname`, `status`, `eintritt`, `austritt`, `standort_id`, `programm`, `graduierung`, `source_updated_at`, `synced_at` |
| `Probetrainings` | Termine und Ergebnisse | `id`, `interessent_id`, `termin`, `trainer_id`, `status`, `erschienen`, `notiz`, `source_updated_at` |
| `Vertraege` | Vertragsmetadaten, keine unnötigen Zahlungsdaten | `id`, `mitglied_id`, `tarif`, `beginn`, `ende`, `status`, `kuendigungsdatum`, `source_updated_at` |
| `Termine` | Kurse und Veranstaltungen | `id`, `titel`, `standort_id`, `trainer_id`, `start`, `ende`, `kapazitaet`, `status` |
| `Teilnahmen` | Verknüpfung von Personen und Terminen | `id`, `termin_id`, `mitglied_id`, `check_in_at`, `status` |
| `Trainer` | Trainerstammdaten | `id`, `anzeigename`, `standort_id`, `rollen`, `aktiv` |
| `Standorte` | Schul-/Studioinformationen | `id`, `name`, `adresse`, `zeitzone`, `aktiv` |
| `Aktivitaeten` | Fachliche Ereignisse für Zapier | `event_id`, `event_type`, `entity_type`, `entity_id`, `occurred_at`, `processed_at`, `payload_hash` |
| `Sync_Protokoll` | Technische Synchronisationsläufe | `run_id`, `started_at`, `finished_at`, `status`, `entity`, `read_count`, `write_count`, `error_count`, `message` |
| `Konfiguration` | Nicht geheime, redaktionelle Werte | `key`, `value`, `description`, `updated_at` |

Passe Spalten nach der HAR-Analyse an. Dokumentiere jede Änderung. Sensible Daten wie Passwörter, vollständige Zahlungsdaten, Gesundheitsdaten oder unnötige Freitextnotizen werden nicht übernommen.

### Apps-Script-Anforderungen

- Versionierter REST-ähnlicher Endpunkt für `GET` und `POST`.
- Authentifizierung jeder schreibenden Anfrage, beispielsweise mit HMAC-Signatur, Zeitstempel und Schutz gegen Replay-Angriffe.
- Schema- und Typvalidierung, Größenlimits, Eingabebereinigung und nachvollziehbare Fehlercodes.
- Idempotente Batch-Upserts anhand der MATOOL-ID und des Änderungszeitpunkts.
- Sperren gegen parallele Schreibzugriffe (`LockService`) und effiziente Batch-Operationen.
- Separater, lesender Dashboard-Endpunkt mit Allowlist der auslieferbaren Felder, Pagination und Filterung.
- Ereignisse werden erst nach erfolgreichem Upsert in `Aktivitaeten` eingetragen.
- Eine Installationsanleitung erklärt Arbeitsmappe, Script Properties, Deployment, Berechtigungen und Secret-Rotation.

---

## Scraper und GitHub Actions

Erstelle ein modular aufgebautes Python-Projekt mit klar getrennten Komponenten für Authentifizierung, MATOOL-Client, Normalisierung, Google-Sheets-Transport und Protokollierung.

### Funktionale Anforderungen

- Analysiere Login, Session-Aufbau, Pagination, Filter und benötigte Requests aus der HAR-Datei.
- Nutze stabile fachliche Endpunkte statt HTML-Selektoren, sofern die analysierten Requests dies zulässig ermöglichen.
- Unterstütze inkrementelle Synchronisation und einen manuell auslösbaren vollständigen Lauf.
- Implementiere Timeouts, begrenzte Retries mit exponentiellem Backoff, Rate-Limiting und verständliche Fehler.
- Schreibe keine personenbezogenen Datensätze oder Secrets in Logs.
- Erzeuge pro Lauf eine eindeutige `run_id` und einen zusammengefassten Sync-Bericht.
- Schlägt die Anmeldung oder Schemaerkennung fehl, darf der Scraper keine unvollständigen Daten überschreiben.

### GitHub-Actions-Workflow

- Trigger: `schedule` per Cron und `workflow_dispatch` mit Auswahl `incremental` oder `full`.
- Installiere Abhängigkeiten reproduzierbar aus einer Lock-/Requirements-Datei.
- Führe Linting, Typprüfung und Tests vor dem Scraping aus.
- Verwende minimale `permissions`, pinne Drittanbieter-Actions auf feste Commit-SHAs und begrenze die Laufzeit.
- Konfiguriere `concurrency`, damit sich Synchronisationsläufe nicht überschneiden.
- Secrets: MATOOL-Zugang beziehungsweise Session-Refresh-Daten, Apps-Script-URL und Signatur-Secret.
- Bei Fehlern: klarer Job-Fehler und optional eine Benachrichtigung, jedoch keine Ausgabe sensibler Inhalte.

---

## Dashboard und vollständige KwonRo-CI

Das Dashboard soll wie eine echte KwonRo-Webanwendung wirken, nicht wie ein generisches Admin-Template. Übernimm die Informationsarchitektur einer modernen Studio-/Liga-Webseite nur als Inspiration; kopiere keine geschützten Texte, Bilder oder Layouts. Die normale öffentliche Webseite und der geschützte Datenbereich sollen visuell aus einem Guss sein.

### Markenfundament

- **Marke:** KwonRo – Die Kampfsportschule
- **Markenessenz:** Menschen durch Kampfkunst stark fürs Leben machen.
- **Leitidee:** Mission Black Belt
- **Philosophie:** Kampfsport unter Freunden
- **Markenwerte:** Herzlichkeit, Gemeinschaft, Respekt, Sicherheit, Gesundheit, Disziplin, persönliche Entwicklung und Professionalität
- **Markenformel:** Stark, aber nicht aggressiv. Professionell, aber nicht distanziert. Traditionell, aber nicht altmodisch. Familiär, aber nicht unstrukturiert.
- **Haupt-CTA:** Kostenloses Probetraining vereinbaren

### Visuelles System

- **Primärfarbe:** KwonRo Navy `#112953`; sie prägt Navigation, Headlines, Buttons und vertrauensbildende Flächen.
- **Sekundärfarbe:** Weiß `#FFFFFF`; großzügig für Ruhe, Klarheit und Kontrast einsetzen.
- Definiere zusätzlich barrierefreie funktionale Farben für Erfolg, Warnung, Fehler und Information. Neue Akzentfarben müssen harmonisch zur Marke passen und als Design Tokens dokumentiert werden.
- **Typografie:** Satoshi als bevorzugte moderne serifenlose Groteskschrift. Falls keine rechtssichere Webfont-Datei vorliegt, verwende einen performanten System-Fallback und dokumentiere die Einbindung.
- Große, selbstbewusste Headlines; gut lesbarer Fließtext; konsistente Typostufen und großzügige Abstände.
- Leicht abgerundete Karten, klare Linien, dezente Schatten und hochwertige Mikrointeraktionen. Keine aggressiven Kampfklischees, Neonfarben oder überladenen Effekte.
- **Bildstil:** authentisch, warm, aktiv und gemeinschaftlich; echte Mitglieder und Trainer, natürliche Momente, Bewegung, Nähe und Vielfalt. Keine austauschbaren Martial-Arts-Stockbilder.
- **Tonalität:** motivierend, herzlich, direkt, klar und kompetent. Nutzer:innen werden konsistent mit „du“ angesprochen.

### Design Tokens und Komponenten

Lege zentrale Tokens für Farben, Typografie, Abstände, Radien, Schatten, Breakpoints und Animationen an. Baue wiederverwendbare Komponenten für:

- Header, Desktop-Navigation, mobile Navigation und Footer,
- Primary-/Secondary-/Text-Buttons und den Probetraining-CTA,
- Hero, Teaser, Werte-, Programm-, Standort-, Trainer- und Testimonial-Karten,
- Formularfelder, Selects, Checkboxen, Validierung und Erfolgszustände,
- Tabellen, Pagination, Filter, Suche, Status-Badges und leere Zustände,
- Kennzahlenkarten, einfache Diagramme, Dialoge, Toasts, Skeletons und Fehlermeldungen.

Alle Zustände (`default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `error`) müssen gestaltet sein. Kontrast, Tastaturbedienung, semantisches HTML, reduzierte Bewegung und Screenreader-Texte richten sich mindestens nach **WCAG 2.2 AA**.

### Öffentliche Webseite

Erstelle mindestens folgende Seiten beziehungsweise Bereiche:

1. **Startseite:** Hero mit Markenessenz und Haupt-CTA, Programme, Vorteile, Mission Black Belt, Stimmen, Standorte und Kontakt.
2. **Programme:** zielgruppengerechte Angebote für Kinder, Jugendliche und Erwachsene, sofern durch Inhalte bestätigt.
3. **Standorte:** Übersicht und Detailansicht mit Trainingsinformationen.
4. **Über KwonRo:** Philosophie, Werte, Trainerteam und Mission.
5. **Probetraining:** kurzes, barrierearmes Formular mit Einwilligung und nachvollziehbarem Erfolgszustand.
6. **Kontakt sowie Datenschutz/Impressum:** reale Inhalte nur aus bereitgestellten Quellen; ansonsten deutlich markierte Platzhalter.

### Geschütztes Daten-Dashboard

Der Verwaltungsbereich darf nicht allein durch eine versteckte URL geschützt sein. Nutze eine zu Cloudflare Pages passende serverseitige Authentifizierung und Rollenprüfung. Mindestens diese Ansichten werden benötigt:

- **Übersicht:** relevante Kennzahlen, letzte Synchronisation, neue Interessenten, anstehende Probetrainings und Sync-Status.
- **Interessenten:** Suche, Filter, Sortierung, Pagination, Detailansicht und klarer Statusverlauf.
- **Mitglieder:** Suche, Filter, Detailansicht, Programm, Standort, Status und Vertragsübersicht.
- **Probetrainings, Verträge, Termine und Teilnahmen:** jeweils eigene Listen- und Detailansichten.
- **Trainer und Standorte:** übersichtliche Stammdatenansichten.
- **Aktivitäten:** fachliche Ereignisse und Zapier-Status.
- **Systemstatus:** letzte Läufe, Anzahl verarbeiteter Datensätze und bereinigte Fehlermeldungen.

Standardmäßig sind Ansichten read-only. Schreibfunktionen dürfen erst nach expliziter Freigabe, Audit-Log und belastbarem Berechtigungskonzept aktiviert werden. Rollen: mindestens `Admin`, `Mitarbeitende` und `Nur Lesen`; sensible Felder werden rollenabhängig ausgeblendet.

### Responsive Verhalten und Qualität

- Mobile First für ca. 320 px bis große Desktop-Displays.
- Tabellen werden auf kleinen Displays zu nutzbaren Karten oder horizontal kontrolliert scrollbar.
- Lighthouse-Ziele für die öffentliche Seite: Performance, Accessibility, Best Practices und SEO jeweils möglichst mindestens 90.
- Bilder responsiv, komprimiert und lazy-loaded; Layout-Verschiebungen vermeiden.
- Aussagekräftige Metadaten, Open-Graph-Daten, Sitemap und strukturierte Daten nur dort, wo fachlich korrekt.

---

## Zapier-Integration

- Zapier reagiert bevorzugt auf neue Zeilen in `Aktivitaeten`, nicht direkt auf jede Änderung in Stammdatenblättern.
- Definiere stabile Eventtypen, zum Beispiel `lead.created`, `trial.scheduled`, `member.created` und `member.status_changed`.
- Verwende `event_id` und `payload_hash`, damit Automationen idempotent bleiben.
- Dokumentiere Trigger, Feldzuordnung, Filter, Testablauf, Fehlerbehandlung und Wiederholung.
- Ein Fehler in Zapier darf die primäre Speicherung nicht rückgängig machen oder den nächsten Sync blockieren.

---

## Erwartete Liefergegenstände

1. Dokumentierte HAR-Analyse mit Endpunkten, Authentifizierung, Pagination, Datenfeldern und Risiken – ohne echte Secrets.
2. Vollständiger Python-Scraper inklusive Konfiguration, Abhängigkeiten und Tests.
3. GitHub-Actions-Workflows für Qualitätssicherung, geplanten Sync und manuellen Full Sync.
4. Google-Apps-Script-Code inklusive Tabellen-Setup, Validierung, Authentifizierung und Deployment-Anleitung.
5. Responsives Cloudflare-Pages-Frontend mit öffentlicher Webseite und geschütztem Dashboard.
6. Dokumentiertes Designsystem mit Tokens, Komponenten und CI-Anwendungsbeispielen.
7. Zapier-Setup-Anleitung und Beispielereignisse.
8. `README` mit lokaler Einrichtung, Umgebungsvariablen, Architekturdiagramm, Deployment, Betrieb, Fehlerbehebung und Secret-Rotation.
9. Tests für Normalisierung, Upserts, API-Validierung und kritische UI-Flows sowie eine kleine anonymisierte Fixture-Datei.

---

## Vorgehen

1. **Bestandsaufnahme:** Anhänge, Repository und vorhandene Infrastruktur analysieren.
2. **Rückfragen:** Nur wirklich blockierende Punkte kompakt sammeln; nichts erfinden.
3. **Konzept:** Zielarchitektur, Datenmodell, Sicherheitsmodell und UI-Sitemap vorlegen.
4. **Vertikaler Prototyp:** Einen anonymisierten Datentyp vollständig von MATOOL über Sheets bis ins Dashboard führen.
5. **Ausbau:** Weitere Entitäten, öffentliche Seiten, Zapier und Rollenmodell ergänzen.
6. **Qualitätssicherung:** Tests, Accessibility, Security Review, responsive Prüfung und Betriebsdokumentation abschließen.

Triff nachvollziehbare technische Entscheidungen und nenne bei jeder Alternative kurz Vor- und Nachteile. Gib ausführbaren Code statt Pseudocode aus. Führe nach jeder Phase die relevanten Tests aus und dokumentiere bekannte Einschränkungen.

---

## Abnahmekriterien

- Ein manueller und ein zeitgesteuerter GitHub-Actions-Lauf synchronisieren anonymisierte Testdaten idempotent in die korrekten Tabellenblätter.
- Doppelte Läufe erzeugen keine Duplikate; Fehler überschreiben keine gültigen Daten.
- Neue fachliche Ereignisse können genau einmal beziehungsweise idempotent von Zapier verarbeitet werden.
- Das Dashboard zeigt sämtliche freigegebenen Tabellenbereiche mit Suche, Filterung, Pagination, Lade-, Leer- und Fehlerzuständen.
- Personenbezogene Daten sind nur nach erfolgreicher Authentifizierung und gemäß Rolle sichtbar.
- Die öffentliche Webseite und das Dashboard verwenden durchgängig KwonRo Navy, Weiß, die definierte Typografie, Bildsprache, Tonalität und Komponenten.
- Die Hauptaktion **„Kostenloses Probetraining vereinbaren“** ist prominent, eindeutig und auf relevanten öffentlichen Seiten erreichbar.
- Die Oberfläche funktioniert per Tastatur, ist responsiv und erfüllt die wesentlichen WCAG-2.2-AA-Anforderungen.
- Repository, Actions-Logs und Frontend-Bundle enthalten keine Zugangsdaten, Cookies oder privaten Quelldaten.
- Installation, Deployment, Secret-Rotation, Recovery und täglicher Betrieb sind so dokumentiert, dass eine weitere Person das System übernehmen kann.

## Noch benötigte Eingaben

Fordere vor der produktiven Implementierung diese Unterlagen an, sofern sie noch nicht vorliegen:

- bereinigte MD- und HAR-Datei sowie Schemagrafiken,
- konkrete URL oder Screenshots der Designreferenz,
- KwonRo-Logo als SVG, lizenzierte Schriften und freigegebene Bilder,
- bestätigte MATOOL-Berechtigung und gewünschtes Sync-Intervall,
- finale Feldliste, Rollen und Datenschutz-/Aufbewahrungsvorgaben,
- Cloudflare-, GitHub-, Google- und Zapier-Zielkonfigurationen.
