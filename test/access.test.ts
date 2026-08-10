import { describe, expect, it } from "vitest";

import {
  accessIdentityFromPayload,
  normalizeAccessTeamDomain,
  requireAccessIdentity
} from "../src/worker/access";
import type { Env } from "../src/worker/env";

describe("Cloudflare-Access-Konfiguration", () => {
  it.each([
    "/",
    "/api/admin/v1/dashboard/overview?range=7",
    "/api/admin/v1/dashboard/activity?page=1",
    "/api/admin/v1/dashboard/records?area=klassen",
    "/api/admin/v1/dashboard/records/0123456789abcdef0123456789abcdef?area=klassen"
  ])("erlaubt auf Staging den maskierten Nur-Lese-Zugriff auf %s", async (path) => {
    const identity = await requireAccessIdentity(
      new Request(`https://middleware.example.invalid${path}`),
      {
        APP_ENV: "staging",
        PUBLIC_DASHBOARD_READ_ONLY: "true"
      } as Env
    );
    expect(identity.authentication).toBe("public-read-only");
  });

  it.each([
    "/api/admin/v1/csrf",
    "/api/admin/v1/matool/sync",
    "/api/admin/v1/dashboard/records/not-a-public-id?area=klassen",
    "/api/zapier/v1/account"
  ])("gibt auf Staging keine schreibende oder ungueltige Route frei: %s", async (path) => {
    await expect(
      requireAccessIdentity(
        new Request(`https://middleware.example.invalid${path}`),
        {
          ACCESS_AUD: "configure-with-cloudflare-access",
          ACCESS_SERVICE_AUD: "configure-with-cloudflare-access-service-app",
          ACCESS_TEAM_DOMAIN: "configure-with-cloudflare-access",
          APP_ENV: "staging",
          PUBLIC_DASHBOARD_READ_ONLY: "true"
        } as Env,
        path.startsWith("/api/zapier/") ? "zapier-service" : "employee"
      )
    ).rejects.toMatchObject({ code: "access_not_configured" });
  });

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
