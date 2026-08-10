import { describe, expect, it } from "vitest";
import type {
  Bundle,
  HttpRequestOptionsWithUrl,
  ZObject
} from "zapier-platform-core";

import { addMiddlewareCredentials } from "../src/middleware.js";

const bundle = {
  authData: {
    service_token: "synthetic-service-token"
  }
} as unknown as Bundle;

describe("Zapier-Request-Middleware", () => {
  it("sendet Zugangsdaten nur an die konfigurierte Middleware", () => {
    const request = addMiddlewareCredentials(
      {
        method: "GET",
        url: "https://middleware.example.invalid/api/zapier/v1/account"
      },
      {} as ZObject,
      bundle
    ) as HttpRequestOptionsWithUrl;

    expect(request.headers).toMatchObject({
      Authorization: "Bearer synthetic-service-token"
    });
    expect(request.headers).not.toHaveProperty("CF-Access-Client-Id");
    expect(request.headers).not.toHaveProperty("CF-Access-Client-Secret");
    expect(request.redirect).toBe("manual");
    expect(request.follow).toBe(0);
  });

  it("verhindert eine Weitergabe an einen fremden Host", () => {
    expect(() =>
      addMiddlewareCredentials(
        {
          method: "GET",
          url: "https://attacker.example.invalid/"
        },
        {} as ZObject,
        bundle
      )
    ).toThrow(/nur an die konfigurierte Middleware/u);
  });
});
