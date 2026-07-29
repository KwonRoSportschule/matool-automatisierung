import { AppError } from "../core/app-error";

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const COMBINED_COOKIE_SEPARATOR =
  /,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/u;

export class RunCookieJar {
  readonly #cookies = new Map<string, string>();

  absorb(headers: Headers, now = new Date()): void {
    for (const header of getSetCookieHeaders(headers)) {
      this.absorbSetCookie(header, now);
    }
  }

  headerValue(): string | null {
    if (this.#cookies.size === 0) {
      return null;
    }

    return [...this.#cookies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  names(): string[] {
    return [...this.#cookies.keys()].sort();
  }

  clear(): void {
    this.#cookies.clear();
  }

  private absorbSetCookie(header: string, now: Date): void {
    const segments = header.split(";").map((segment) => segment.trim());
    const pair = segments.shift();
    if (!pair) {
      return;
    }

    const separator = pair.indexOf("=");
    if (separator <= 0) {
      return;
    }

    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (
      !COOKIE_NAME.test(name) ||
      value.includes("\r") ||
      value.includes("\n")
    ) {
      throw new AppError(
        "invalid_session_cookie",
        502,
        "MATOOL hat ein ungültiges Session-Cookie geliefert."
      );
    }

    const attributes = new Map<string, string>();
    for (const segment of segments) {
      const attributeSeparator = segment.indexOf("=");
      const attributeName = (
        attributeSeparator === -1
          ? segment
          : segment.slice(0, attributeSeparator)
      ).toLowerCase();
      const attributeValue =
        attributeSeparator === -1
          ? ""
          : segment.slice(attributeSeparator + 1);
      attributes.set(attributeName, attributeValue);
    }

    const maxAge = attributes.get("max-age");
    const expires = attributes.get("expires");
    const expiredByMaxAge =
      maxAge !== undefined &&
      Number.isFinite(Number(maxAge)) &&
      Number(maxAge) <= 0;
    const expiredByDate =
      expires !== undefined &&
      Number.isFinite(Date.parse(expires)) &&
      Date.parse(expires) <= now.getTime();

    if (value.length === 0 || expiredByMaxAge || expiredByDate) {
      this.#cookies.delete(name);
      return;
    }

    this.#cookies.set(name, value);
  }
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof extendedHeaders.getSetCookie === "function") {
    return extendedHeaders.getSetCookie();
  }

  const combined = headers.get("Set-Cookie");
  return combined
    ? combined
        .split(COMBINED_COOKIE_SEPARATOR)
        .map((header) => header.trim())
        .filter(Boolean)
    : [];
}
