PRAGMA foreign_keys = ON;

-- Darstellungsfelder aus den gespeicherten Snapshots entfernen.
--
-- "tableIndex" hielt fest, an welcher Stelle der gerenderten MATOOL-Seite eine
-- Zeile stand, "columnCount" wie viele Spalten sie hatte. Beides ist kein
-- Fachwert, floss aber in den Inhaltshash ein. Weil MATOOL die
-- Interessentenliste absteigend nach Nummer sortiert, verschob schon ein
-- einziger neuer Interessent die Position jedes aelteren Datensatzes -- und
-- der komplette Bestand galt als geaendert. Belegt am 10.09.2026: 3.505
-- gespeicherte Interessenten, 7.009 gemeldete Aenderungen in 24 Stunden bei
-- genau 2 tatsaechlich neuen Datensaetzen; die 30 vorkommenden
-- tableIndex-Werte 2, 5, 8, ... 89 entsprechen exakt den 30 Zeilen einer
-- Listenseite.
--
-- Die Felder werden aus dem gespeicherten Payload entfernt. Der Inhaltshash
-- wird auf den leeren Wert gesetzt: Er kennzeichnet einen Datensatz, dessen
-- Hash bewusst verworfen wurde. Fuer diese Datensaetze vergleicht der
-- naechste Lauf den Payload selbst statt den Hash und uebernimmt den neu
-- berechneten Hash danach. Sonst meldete allein diese Umstellung erneut den
-- gesamten Bestand als geaendert; ein blosses Unterdruecken wiederum wuerde
-- eine echte Aenderung verschlucken, die zwischen Migration und naechstem
-- Lauf in MATOOL passiert.
--
-- json_remove erhaelt die Reihenfolge der verbleibenden Schluessel, und der
-- Store schreibt seinen Payload bereits als minifiziertes JSON mit sortierten
-- Schluesseln. Der Vergleich ist damit zeichengenau; test/matool-store.test.ts
-- belegt das an einem Datensatz mit Umlauten und Sonderzeichen.
--
-- Der bereits geschriebene Aenderungsverlauf in matool_snapshot_changes
-- bleibt unangetastet. Er ist Vergangenheit und wird nicht umgeschrieben.
UPDATE matool_snapshots
   SET payload_json = json_remove(payload_json, '$.tableIndex', '$.columnCount'),
       content_hash = ''
 WHERE json_extract(payload_json, '$.tableIndex') IS NOT NULL
    OR json_extract(payload_json, '$.columnCount') IS NOT NULL;
