-- Read-only, aggregate-only companion check for the prospect read model.
-- Grain: one current interessenten list row per source_id, optional details.
-- A detail read before its list row is not automatically stale: ingestion
-- continues in batches. No raw names, IDs, contacts or notes are returned.
SELECT datetime('now') AS checked_at_utc, area, COUNT(*) AS rows,
       COUNT(DISTINCT source_id) AS unique_source_ids,
       SUM(CASE WHEN json_valid(payload_json) THEN 0 ELSE 1 END) AS invalid_json,
       MIN(last_seen_at) AS oldest_read_at, MAX(last_seen_at) AS newest_read_at
FROM matool_snapshots
WHERE area IN ('interessenten', 'interessenten_details')
GROUP BY area;

SELECT datetime('now') AS checked_at_utc, COUNT(*) AS list_rows,
       SUM(CASE WHEN details.source_id IS NULL THEN 1 ELSE 0 END) AS missing_details,
       SUM(CASE WHEN details.last_seen_at < list.last_seen_at THEN 1 ELSE 0 END) AS details_read_before_list,
       SUM(CASE WHEN details.last_seen_at >= list.last_seen_at THEN 1 ELSE 0 END) AS details_read_since_list,
       SUM(CASE WHEN details.last_changed_at > list.last_changed_at THEN 1 ELSE 0 END) AS newer_detail_change
FROM matool_snapshots AS list
LEFT JOIN matool_snapshots AS details
  ON details.area = 'interessenten_details' AND details.source_id = list.source_id
WHERE list.area = 'interessenten';

SELECT datetime('now') AS checked_at_utc, COUNT(*) AS details_without_current_list
FROM matool_snapshots AS details
LEFT JOIN matool_snapshots AS list
  ON list.area = 'interessenten' AND list.source_id = details.source_id
WHERE details.area = 'interessenten_details' AND list.source_id IS NULL;

WITH compared AS (
  SELECT fields.key AS field,
         fields.value AS list_value,
         json_extract(details.payload_json, '$.' || fields.key) AS detail_value,
         details.last_seen_at < list.last_seen_at AS detail_read_before_list
  FROM matool_snapshots AS list
  JOIN matool_snapshots AS details
    ON details.area = 'interessenten_details' AND details.source_id = list.source_id,
       json_each(CASE WHEN json_valid(list.payload_json) THEN list.payload_json ELSE '{}' END) AS fields
  WHERE list.area = 'interessenten' AND json_valid(details.payload_json)
    AND fields.key IN ('vorname', 'name', 'status', 'datum')
)
SELECT field, COUNT(*) AS compared_rows,
       SUM(CASE WHEN list_value IS NOT detail_value THEN 1 ELSE 0 END) AS differing_rows,
       SUM(CASE WHEN list_value IS NOT detail_value AND detail_read_before_list THEN 1 ELSE 0 END) AS differing_older_details
FROM compared GROUP BY field;
