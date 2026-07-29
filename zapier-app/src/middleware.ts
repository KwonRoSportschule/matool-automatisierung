import type { BeforeRequestMiddleware } from "zapier-platform-core";

import { configuredMiddlewareOrigin } from "./constants.js";

export const addMiddlewareCredentials: BeforeRequestMiddleware = (
  request,
  _z,
  bundle
) => {
  const middlewareOrigin = configuredMiddlewareOrigin();
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin !== middlewareOrigin) {
    throw new Error(
      "Anmeldeinformationen dürfen nur an die konfigurierte Middleware gesendet werden."
    );
  }

  request.headers = {
    ...request.headers,
    Authorization: `Bearer ${bundle.authData.service_token ?? ""}`,
    "CF-Access-Client-Id": bundle.authData.access_client_id ?? "",
    "CF-Access-Client-Secret":
      bundle.authData.access_client_secret ?? ""
  };
  request.redirect = "manual";
  request.follow = 0;
  return request;
};
