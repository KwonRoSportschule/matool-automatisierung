import type {
  Authentication,
  Bundle,
  ZObject
} from "zapier-platform-core";

import { API_PATHS, middlewareApiUrl } from "./constants.js";

interface AccountResponse {
  environment: string;
  id: string;
}

const testAuthentication = async (z: ZObject, _bundle: Bundle) => {
  const response = await z.request<AccountResponse>({
    method: "GET",
    url: middlewareApiUrl(API_PATHS.account)
  });
  response.throwForStatus();
  return response.data;
};

const connectionLabel = async (z: ZObject, bundle: Bundle) => {
  const account = await testAuthentication(z, bundle);
  return `MATOOL Middleware - ${account.environment}`;
};

export default {
  type: "custom",
  fields: [
    {
      key: "service_token",
      label: "Middleware Service-Token",
      type: "password",
      required: true
    }
  ],
  test: testAuthentication,
  connectionLabel
} satisfies Authentication;

export { connectionLabel, testAuthentication };
