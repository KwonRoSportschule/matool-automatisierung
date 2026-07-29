import {
  defineApp,
  version as platformVersion
} from "zapier-platform-core";
import packageJson from "../package.json" with { type: "json" };

import authentication from "./authentication.js";
import confirmContactResult from "./creates/confirm-contact-result.js";
import { addMiddlewareCredentials } from "./middleware.js";
import firstTrialContact from "./triggers/first-trial-contact.js";

export default defineApp({
  version: packageJson.version,
  platformVersion,
  flags: {
    cleanInputData: false
  },
  authentication,
  beforeRequest: [addMiddlewareCredentials],
  triggers: {
    [firstTrialContact.key]: firstTrialContact
  },
  creates: {
    [confirmContactResult.key]: confirmContactResult
  }
});
