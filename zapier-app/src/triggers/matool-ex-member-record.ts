import { createFixedAreaRecordTrigger } from "./fixed-area-record.js";

const sample = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  area: "schueler_ex",
  source_id: "67890",
  matool_id: "67890",
  content_hash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  first_seen_at: "2026-08-10T09:00:00.000Z",
  last_seen_at: "2026-08-10T10:00:00.000Z",
  last_changed_at: "2026-08-10T10:00:00.000Z",
  is_new: true,
  nr: "42",
  vorname: "Beispiel",
  name: "Ehemalig",
  vertrag: "Synthetischer Vertrag"
};

export default createFixedAreaRecordTrigger({
  area: "schueler_ex",
  key: "matool_ex_member_record_v1",
  noun: "Ehemaliges Mitglied",
  label: "MATOOL-Mitglied Ausgeschieden",
  description:
    "Triggers when MATOOL lists a member as an ex-member after the cancellation is complete. It never sends messages or changes MATOOL data.",
  sample
});
