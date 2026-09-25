import {
  defineApp,
  version as platformVersion
} from "zapier-platform-core";
import packageJson from "../package.json" with { type: "json" };

import authentication from "./authentication.js";
import beitragsuebersicht from "./creates/beitragsuebersicht.js";
import { addMiddlewareCredentials } from "./middleware.js";
import matoolCheckinRecord from "./triggers/matool-checkin-record.js";
import matoolGraduierungRecord from "./triggers/matool-graduierung-record.js";
import matoolMemberRecord from "./triggers/matool-member-record.js";
import matoolExMemberRecord from "./triggers/matool-ex-member-record.js";
import matoolProspectRecord from "./triggers/matool-prospect-record.js";
import matoolRecord from "./triggers/matool-record.js";
import matoolRecordLegacy from "./triggers/matool-record-legacy.js";

export default defineApp({
  version: packageJson.version,
  platformVersion,
  flags: {
    cleanInputData: false
  },
  authentication,
  beforeRequest: [addMiddlewareCredentials],
  triggers: {
    [matoolRecordLegacy.key]: matoolRecordLegacy,
    [matoolRecord.key]: matoolRecord,
    [matoolProspectRecord.key]: matoolProspectRecord,
    [matoolMemberRecord.key]: matoolMemberRecord,
    [matoolExMemberRecord.key]: matoolExMemberRecord,
    [matoolCheckinRecord.key]: matoolCheckinRecord,
    [matoolGraduierungRecord.key]: matoolGraduierungRecord
  },
  creates: {
    [beitragsuebersicht.key]: beitragsuebersicht
  }
});
