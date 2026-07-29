import { describe, expect, it } from "vitest";

import { normalizeAccessTeamDomain } from "../src/worker/access";

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
});
