import {
  defineApp,
  version as platformVersion
} from "zapier-platform-core";
import packageJson from "../package.json" with { type: "json" };

import authentication from "./authentication.js";
import { addMiddlewareCredentials } from "./middleware.js";
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
    [matoolRecord.key]: matoolRecord
  }
});
