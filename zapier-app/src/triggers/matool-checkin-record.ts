import { createFixedAreaRecordTrigger } from "./fixed-area-record.js";

const sample = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  area: "checkin",
  source_id: "c_67890_20260826182730_1340",
  matool_id: null,
  content_hash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  first_seen_at: "2026-08-26T16:27:30.000Z",
  last_seen_at: "2026-08-26T16:27:30.000Z",
  last_changed_at: "2026-08-26T16:27:30.000Z",
  is_new: true,
  mitglied_id: "67890",
  klasse_id: "1340",
  checkin_datum: "2026-08-26",
  checkin_uhrzeit: "18:27:30",
  checkin_zeitpunkt: "2026-08-26T18:27:30"
};

export default createFixedAreaRecordTrigger({
  area: "checkin",
  key: "matool_checkin_record_v1",
  noun: "Check-in",
  label: "Neuer MATOOL-Check-in",
  description:
    "Triggers for every newly recorded MATOOL check-in. It only provides technical IDs and the check-in time; it never changes MATOOL data.",
  sample
});
