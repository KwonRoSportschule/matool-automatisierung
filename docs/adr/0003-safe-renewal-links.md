# ADR 0003: Keine Personendaten in Verlängerungslinks

Status: vorgeschlagen  
Datum: 29. Juli 2026

## Kontext

Der dokumentierte Altprozess setzt E-Mail-Adresse und Geburtsdatum als
Query-Parameter in einen Verlängerungslink. Solche Werte können in
Browserhistorie, Serverlogs, Analytics, Screenshots und Referrer-Headern
erscheinen.

## Entscheidung

Eine spätere öffentliche Verlängerungsseite verwendet ausschließlich einen
undurchsichtigen, zeitlich begrenzten Zufallstoken. Der Tokenwert wird nicht in
Logs oder D1 gespeichert; D1 speichert nur einen kryptografischen Hash.

## Mindestanforderungen

- mindestens 128 Bit kryptografischer Zufall;
- HTTPS;
- fester Ablaufzeitpunkt;
- Bindung an genau einen Vorgang;
- serverseitige Statusprüfung;
- widerrufbar;
- Rate-Limit und Missbrauchsschutz;
- kein Token in Analytics oder Anwendungslogs;
- keine Klartext-Personenattribute wie E-Mail, Name oder Geburtsdatum in Pfad,
  Fragment oder Query-Parametern;
- bestehende Daten werden erst nach erfolgreicher Tokenprüfung geladen.

Bevorzugter Austausch:

1. Der einmalige Token steht im URL-Fragment und wird deshalb nicht an den
   Server oder in Referrer-Header gesendet.
2. Ausschließlich First-Party-JavaScript sendet ihn einmalig per HTTPS-POST.
3. Der Server validiert und verbraucht den Token und setzt eine kurzlebige
   `Secure; HttpOnly; SameSite=Strict`-Session.
4. Die Seite entfernt das Fragment sofort mit `history.replaceState`.
5. Die Seite lädt keine Drittanbieterressourcen oder Analytics.

Der Token bleibt trotz fehlender Klartext-Personendaten ein sensibles,
personenbeziehbares Pseudonym.

## Konsequenzen

- Das öffentliche Formular ist eine eigene Sicherheits- und Rechtsfreigabe.
- Jotform kann nur beibehalten werden, wenn der Token sicher serverseitig
  aufgelöst wird und keine sensiblen Werte in der Weiterleitung landen.
- Ein öffentlich per Link lesbares Google Sheet ist kein zulässiger
  Zustellmechanismus für diesen Entwurf.
