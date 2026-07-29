# ADR 0002: D1 als Zustands- und Ereignisspeicher

Status: vorgeschlagen  
Datum: 29. Juli 2026

## Kontext

Der Hub benötigt eindeutige Datensätze, atomare Zustandsübergänge,
deduplizierte Ereignisse, eine Outbox, Zustellversuche und eine zuverlässige
Laufsperre.

Workers KV ist eventual consistent und besitzt keine Transaktionen. Änderungen
können an anderen Standorten verzögert sichtbar werden. Damit ist KV für
Konfiguration und Cache geeignet, aber nicht als alleinige Quelle für
Ereignisdeduplizierung oder Leases.

## Entscheidung

D1 wird bereits im MVP als autoritativer Speicher verwendet. Die Datenbank wird
bei Erstellung auf die EU-Jurisdiktion beschränkt.

## Gründe

- SQL-Constraints für `source_key` und `event_id`;
- atomare Batch-Transaktionen;
- eindeutige Outbox- und Delivery-Zustände;
- besser prüfbare Migrationen und Abfragen;
- die bekannten D1-Free-Tier-Grenzen erscheinen für 13 kleine Läufe pro
  Werktag plausibel, müssen aber im PoC anhand gelesener und geschriebener
  Zeilen bestätigt werden;
- EU-Jurisdiktion kann nur bei Erstellung festgelegt werden.

## Konsequenzen

- Schema und Migrationen gehören ab dem ersten Commit zur Anwendung.
- Tabellen und Indizes müssen auf gelesene und geschriebene Zeilen optimiert
  werden.
- Personenfelder werden minimiert und erhalten festgelegte Löschfristen.
- Read Replication bleibt zunächst deaktiviert.

## Alternative

Ein SQLite-backed Durable Object kann später zusätzlich pro MATOOL-Konto die
Ausführung serialisieren. Für den ersten einzelnen Account wird ein D1-Lease
nur dann akzeptiert, wenn Owner-Prüfung, TTL, Heartbeat, Freigabe und ein
monotoner Fencing-Token in Konkurrenz- und Ablaufzeit-Tests bestehen.

## Referenzen

- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/configuration/data-location/
- https://developers.cloudflare.com/d1/platform/pricing/
