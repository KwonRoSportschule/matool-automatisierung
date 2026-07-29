# Offene Entscheidungen

Status: zur gemeinsamen Klärung  
Stand: 29. Juli 2026

Keine dieser Entscheidungen erfordert Zugangsdaten im Chat oder Repository.

## Priorität 0: vor Implementierung des realen Connectors

### OD-001: Umfang der ersten Webseite

**Empfehlung:** internes, durch Cloudflare Access geschütztes Admin-Dashboard.

Alternativen:

1. nur Admin-Dashboard;
2. Admin-Dashboard plus öffentliche Verlängerungsseite;
3. ausschließlich Backend ohne sichtbare Oberfläche.

Auswirkung: Eine öffentliche Seite benötigt Tokenverwaltung, rechtliche
Abnahmetexte, Missbrauchsschutz und einen deutlich größeren Testumfang.

### OD-002: Quellcode der vorhandenen Zapier-MATOOL-Integration

Zu klären: Ist der Quellcode oder ein Export der privaten Integration mit
„Find Memberships / Upcoming Membership Renewals“ verfügbar?

**Empfehlung:** zuerst diesen Quellcode beschaffen. Er kann Login-, Parser- und
Feldwissen enthalten, das in der HAR fehlt.

Falls nicht verfügbar, wird ein lokaler, redigierender Probe-Client gebaut.

### OD-003: Zustimmung und Nutzungsrahmen für MATOOL-Automation

Zu klären:

- erlaubt der Vertrag beziehungsweise Anbieter automatisierte Zugriffe über den
  eigenen Account;
- gibt es ein Rate-Limit oder eine bevorzugte technische Schnittstelle;
- dürfen Cloudflare-Ausgangsadressen auf MATOOL zugreifen;
- existieren MFA, CAPTCHA oder IP-Freigaben.

**Empfehlung:** vor Produktivbetrieb schriftlich klären; der lokale read-only
PoC kann vorher mit minimaler Frequenz erfolgen, sofern intern autorisiert.

### OD-004: Stabiler Quellschlüssel

Zu klären: Liefert die relevante MATOOL-Seite eine unveränderliche
Mitgliedschafts- oder Vertrags-ID?

Ohne stabilen Schlüssel wird kein produktiver Collector freigegeben.

## Priorität 1: vor Zapier-Test

### OD-005: Zapier-Tarif und Richtung

Benötigte Information: aktueller Zapier-Tarif.

**Empfehlung bei Professional/Team/Enterprise:** Worker sendet deduplizierte
Outbox-Ereignisse an einen Catch Hook.

**Fallback:** signierte Google-Apps-Script-Brücke mit privater Tabelle und
append-only Ereignisblatt.

Noch zu entscheiden:

- Worker pusht an Zapier;
- Zapier pollt eine Middleware-API;
- Google Sheets vermittelt.

### OD-006: Ereignis-Deduplizierung in Zapier

Zu klären: Wie verhindert der Zap eine zweite Kundenaktion, falls ein
Webhook-Response verloren geht?

Mögliche Lösungen:

- deduplizierende Tabelle oder Storage-Schritt in Zapier;
- Rückbestätigung an die Middleware;
- idempotente Zielaktion;
- manuelle Freigabe für sensible Kontaktaktionen.

### OD-007: Bestehender Wochenreport

**Empfehlung:** zunächst unverändert lassen und getrennt beobachten.

Später kann die Middleware `follow_up_due`-Ereignisse erzeugen und den
öffentlich freigegebenen XLSX-Export ersetzen.

## Priorität 2: vor Produktivfreigabe

### OD-008: Datenaufbewahrung

Fristen festlegen für:

- technische Runs und Fehler;
- aktuelle Datensätze;
- Ereignisversionen;
- erfolgreiche und fehlgeschlagene Zustellungen;
- offene Verlängerungen;
- abgeschlossene Verlängerungen;
- später eventuell Token.

### OD-009: Standorte und Sektoren

Zu klären:

- ein gemeinsamer Lauf oder getrennte Läufe je Standort;
- eigene Zugangsdaten je Standort;
- standortabhängige Tarife und Empfänger;
- maximale Kandidatenzahl je Lauf.

### OD-010: Verlängerungsformular

Optionen:

1. Jotform beibehalten, aber nur mit undurchsichtigem Token;
2. eigene öffentliche Cloudflare-Seite;
3. bestehende WordPress-Seite anbinden.

Hierfür sind Datenschutz-, Vertrags- und Prozessprüfung gesondert erforderlich.

### OD-011: Cloudflare-Zugriff

Benötigt werden später:

- Cloudflare-Konto und gewünschte Domain;
- erlaubte Admin-Identitäten für Cloudflare Access;
- GitHub-Repository-Verknüpfung;
- getrennte Staging- und Produktionsressourcen;
- EU-Jurisdiktion für D1 bereits bei Erstellung.

## Empfohlene Antwortreihenfolge

Für den nächsten Implementierungsschnitt reichen zunächst vier Antworten:

1. Admin-Dashboard zuerst: ja oder nein?
2. Zapier-Tarif?
3. Quellcode der privaten MATOOL-Zapier-App verfügbar: ja oder nein?
4. GLZ-Prozess als Pilot bestätigt: ja oder nein?

