import { createFixedAreaRecordTrigger } from "./fixed-area-record.js";

const sample = {
  id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  area: "schueler_details",
  source_id: "67890",
  matool_id: "67890",
  content_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  first_seen_at: "2026-08-10T09:00:00.000Z",
  last_seen_at: "2026-08-10T10:00:00.000Z",
  last_changed_at: "2026-08-10T10:00:00.000Z",
  is_new: false,
  schueler_nr: "67890",
  vertragid: "synthetic-contract-id",
  vname: "Beispiel",
  name: "Mitglied",
  email: "mitglied@example.invalid",
  handy: "+490000000001",
  telefon: "+490000000002",
  vertragsbeginn: "2026-08-01",
  vertragsende: "2027-08-01",
  vertrag: "Synthetischer Vertrag",
  klassenliste: "Synthetische Klasse",
  spartenliste: "Synthetische Sparte",
  abschluss: "",
  kuendigungsfrist: "",
  verlaengerung: ""
};

export default createFixedAreaRecordTrigger({
  area: "schueler_details",
  key: "matool_member_record_v1",
  noun: "Mitglied",
  label: "Neues Oder Geändertes MATOOL-Mitglied",
  description:
    "Triggers when a minimized MATOOL member detail record is new or changes. It never sends messages or changes MATOOL data.",
  sample
});
