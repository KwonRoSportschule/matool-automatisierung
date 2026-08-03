import {
  defineApp,
  version as platformVersion
} from "zapier-platform-core";
import packageJson from "../package.json" with { type: "json" };

import authentication from "./authentication.js";
import confirmContactResult from "./creates/confirm-contact-result.js";
import { addMiddlewareCredentials } from "./middleware.js";
import firstTrialContact from "./triggers/first-trial-contact.js";
import matoolRecord from "./triggers/matool-record.js";

export default defineApp({
  version: packageJson.version,
  platformVersion,
  flags: {
    cleanInputData: false
  },
  authentication,
  beforeRequest: [addMiddlewareCredentials],
  triggers: {
    [firstTrialContact.key]: firstTrialContact,
    [matoolRecord.key]: matoolRecord
  },
  creates: {
    [confirmContactResult.key]: confirmContactResult
  }
});
