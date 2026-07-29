import { describe, expect, it } from "vitest";

import {
  accessIdentityFromPayload,
  normalizeAccessTeamDomain,
  requireAccessIdentity
} from "../src/worker/access";
import type { Env } from "../src/worker/env";

describe("Cloudflare-Access-Konfiguration", () => {
  it("normalisiert eine echte Team-Domain auf ihren HTTPS-Issuer", () => {
    expect(
      normalizeAccessTeamDomain("synthetic-team.cloudflareaccess.com")
    ).toBe("https://synthetic-team.cloudflareaccess.com");
  });

  it.each([
    "http://synthetic-team.cloudflareaccess.com",
    "https://cloudflareaccess.com",
    "https://attacker.invalid",
    "https://synthetic-team.cloudflareaccess.com/path"
  ])("verweigert die Access-Domain %s", (value) => {
    expect(() => normalizeAccessTeamDomain(value)).toThrowError(
      expect.objectContaining({
        code: "access_not_configured"
      })
    );
  });

  it("verweigert eine gemeinsame Audience für Mitarbeiter und Zapier-Service", async () => {
    const incompleteEnv = {
      ACCESS_AUD: "shared-test-audience",
      ACCESS_SERVICE_AUD: "shared-test-audience",
      ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com",
      APP_ENV: "staging"
    } as Env;

    await expect(
      requireAccessIdentity(
        new Request("https://middleware.example.invalid/api/zapier/v1/account"),
        incompleteEnv,
        "zapier-service"
      )
    ).rejects.toMatchObject({
      code: "access_not_configured"
    });
    await expect(
      requireAccessIdentity(
        new Request("https://middleware.example.invalid/"),
        incompleteEnv,
        "employee"
      )
    ).rejects.toMatchObject({
      code: "access_not_configured"
    });
  });

  it("erkennt Mitarbeiter- und Service-JWT-Payloads anhand getrennter Claims", () => {
    expect(
      accessIdentityFromPayload(
        {
          email: "employee@example.invalid",
          sub: "synthetic-employee-id",
          type: "app"
        },
        "employee"
      )
    ).toEqual({
      authentication: "cloudflare-access",
      email: "employee@example.invalid",
      subject: "synthetic-employee-id"
    });

    expect(
      accessIdentityFromPayload(
        {
          common_name: "synthetic-service-client.access",
          sub: "",
          type: "app"
        },
        "zapier-service"
      )
    ).toEqual({
      authentication: "cloudflare-access",
      subject: "service-token:synthetic-service-client.access"
    });
  });

  it("akzeptiert weder Service-Claims als Mitarbeiter noch Benutzer-Claims als Service", () => {
    expect(() =>
      accessIdentityFromPayload(
        {
          common_name: "synthetic-service-client.access",
          sub: "",
          type: "app"
        },
        "employee"
      )
    ).toThrow();
    expect(() =>
      accessIdentityFromPayload(
        {
          sub: "synthetic-employee-id",
          type: "app"
        },
        "zapier-service"
      )
    ).toThrow();
  });
});
