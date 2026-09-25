import { createFixedAreaRecordTrigger } from "./fixed-area-record.js";
import { sample } from "./matool-record.js";

export default createFixedAreaRecordTrigger({
  area: "interessenten_details",
  key: "matool_prospect_record_v1",
  noun: "Interessent",
  label: "Neuer Oder Geänderter MATOOL-Interessent",
  description:
    "Triggers when a stored MATOOL prospect detail record is new or changes. It never sends messages or changes MATOOL data.",
  onlyNewLabel: "Nur neue Interessenten",
  onlyNewHelpText:
    "Aktiviert: der Zap startet ausschließlich, wenn ein Interessent erstmals in MATOOL erscheint. Änderungen an bestehenden Interessenten werden nicht gemeldet.",
  sample
});
