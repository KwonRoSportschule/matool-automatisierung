import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import {
  assertAllowedMatoolUrl,
  MatoolClient,
  validateMatoolBaseUrl
} from "../src/matool/client";

describe("MATOOL-Ausgangs-Host-Allowlist", () => {
  it("akzeptiert ausschließlich die verifizierte HTTPS-Basisadresse", () => {
    expect(validateMatoolBaseUrl("https://core.matool.de").origin).toBe(
      "https://core.matool.de"
    );
  });

  it.each([
    "http://core.matool.de",
    "https://core.matool.de.attacker.invalid",
    "https://user:pass@core.matool.de",
    "https://core.matool.de:8443"
  ])("blockiert %s", (value) => {
    expect(() => validateMatoolBaseUrl(value)).toThrow(AppError);
  });

  it("blockiert einen Redirect zu einem fremden Host", () => {
    expect(() =>
      assertAllowedMatoolUrl(
        new URL("https://attacker.invalid/index.php")
      )
    ).toThrowError(
      expect.objectContaining({
        code: "matool_redirect_blocked"
      })
    );
  });

  it("führt Login und Interessenten-Probe in genau einer Lauf-Session aus", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const responses = [
      new Response(null, {
        headers: {
          Location: "/index.php",
          "Set-Cookie":
            "synthetic_session=opaque-test-value; Path=/; Secure; HttpOnly"
        },
        status: 302
      }),
      new Response("<html><body>Angemeldete Oberfläche</body></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200
      }),
      new Response(
        "<html><body><h1>Interessenten</h1><table><tr></tr><tr></tr></table></body></html>",
        {
          headers: { "Content-Type": "text/html" },
          status: 200
        }
      )
    ];
    const client = new MatoolClient(
      "https://core.matool.de",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ ...(init ? { init } : {}), url: String(input) });
        const response = responses.shift();
        if (!response) {
          throw new Error("unexpected synthetic request");
        }
        return response;
      }) as typeof fetch
    );

    const result = await client.probeInteressenten({
      email: "service-account@example.invalid",
      password: "synthetic-password"
    });

    expect(requests).toHaveLength(3);
    expect(requests.every(({ url }) => url.startsWith("https://core.matool.de/"))).toBe(
      true
    );
    expect(
      new Headers(requests[1]?.init?.headers).get("Cookie")
    ).toBe("synthetic_session=opaque-test-value");
    expect(result.rowMarkerCount).toBe(2);
    expect(result.loginFormDetected).toBe(false);
    expect(result.interestMarkerDetected).toBe(true);
  });
});
