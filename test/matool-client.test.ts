import { describe, expect, it } from "vitest";

import { AppError } from "../src/core/app-error";
import {
  assertAllowedMatoolUrl,
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
});
