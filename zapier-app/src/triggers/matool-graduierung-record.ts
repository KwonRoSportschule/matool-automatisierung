import { createFixedAreaRecordTrigger } from "./fixed-area-record.js";

const sample = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  area: "graduierungen",
  source_id: "g_67890_15359",
  matool_id: null,
  content_hash:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  first_seen_at: "2026-08-26T16:27:30.000Z",
  last_seen_at: "2026-08-26T16:27:30.000Z",
  last_changed_at: "2026-08-26T16:27:30.000Z",
  is_new: true,
  mitglied_id: "67890",
  graduierung_id: "15359",
  pruefungsdatum: "2026-08-26",
  graduierung: "Synthetischer Grad",
  sparte: "Synthetische Sparte",
  storniert: false,
  pdf_verfuegbar: false
};

export default createFixedAreaRecordTrigger({
  area: "graduierungen",
  key: "matool_graduierung_record_v1",
  noun: "Prüfung",
  label: "Neue Oder Geänderte MATOOL-Prüfung",
  description:
    "Triggers when MATOOL records or changes a graduation entry, including its cancellation status. It never changes MATOOL data.",
  sample
});
