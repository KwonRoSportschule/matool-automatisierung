import { describe, expect, it } from "vitest";

import { RunCookieJar } from "../src/matool/cookie-jar";

describe("laufbezogene MATOOL-Cookies", () => {
  it("übernimmt nur Cookie-Paare und gibt keine Attribute weiter", () => {
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      "synthetic_session=opaque-value; Path=/; Secure; HttpOnly"
    );
    headers.append(
      "Set-Cookie",
      "synthetic_preference=compact; Path=/; SameSite=Lax"
    );

    const jar = new RunCookieJar();
    jar.absorb(headers);

    expect(jar.names()).toEqual([
      "synthetic_preference",
      "synthetic_session"
    ]);
    expect(jar.headerValue()).toBe(
      "synthetic_preference=compact; synthetic_session=opaque-value"
    );
  });

  it("entfernt abgelaufene Sessionwerte", () => {
    const jar = new RunCookieJar();
    jar.absorb(
      new Headers({
        "Set-Cookie": "synthetic_session=opaque-value; Path=/"
      })
    );
    jar.absorb(
      new Headers({
        "Set-Cookie": "synthetic_session=; Max-Age=0; Path=/"
      })
    );

    expect(jar.headerValue()).toBeNull();
  });

  it("verwirft die gesamte Session am Laufende", () => {
    const jar = new RunCookieJar();
    jar.absorb(
      new Headers({
        "Set-Cookie": "synthetic_session=opaque-value; Path=/"
      })
    );
    jar.clear();
    expect(jar.names()).toEqual([]);
  });
});
