import { AppError } from "../core/app-error";
import { RunCookieJar } from "./cookie-jar";

const ALLOWED_MATOOL_HOST = "core.matool.de";
const MAX_PROBE_BYTES = 2_000_000;

export interface MatoolCredentials {
  email: string;
  password: string;
}

export interface InteressentenProbeResult {
  bodyBytes: number;
  contentType: string;
  cookieNames: string[];
  interestMarkerDetected: boolean;
  loginFormDetected: boolean;
  rowMarkerCount: number;
  status: number;
}

export class MatoolClient {
  readonly #baseUrl: URL;
  readonly #cookies = new RunCookieJar();
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = validateMatoolBaseUrl(baseUrl);
    this.#fetch = fetchImplementation;
  }

  async probeInteressenten(
    credentials: MatoolCredentials
  ): Promise<InteressentenProbeResult> {
    requireCredentials(credentials);
    await this.login(credentials);

    const response = await this.request("/index.php?show=interessenten", {
      headers: {
        Accept: "text/html,application/xhtml+xml"
      },
      method: "GET"
    });

    const declaredLength = Number(
      response.headers.get("Content-Length") ?? "0"
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_PROBE_BYTES
    ) {
      throw new AppError(
        "matool_response_too_large",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Probe-Limit."
      );
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_PROBE_BYTES) {
      throw new AppError(
        "matool_response_too_large",
        502,
        "Die MATOOL-Antwort überschreitet das sichere Probe-Limit."
      );
    }

    const text = new TextDecoder().decode(body);
    const loginFormDetected =
      /name\s*=\s*["']mail["']/iu.test(text) &&
      /name\s*=\s*["']pass["']/iu.test(text);
    const interestMarkerDetected = /interessent/iu.test(text);

    if (loginFormDetected || !interestMarkerDetected) {
      throw new AppError(
        "matool_authentication_unverified",
        502,
        "Die angemeldete MATOOL-Interessentenansicht konnte nicht bestätigt werden."
      );
    }

    return {
      bodyBytes: body.byteLength,
      contentType: response.headers.get("Content-Type") ?? "unknown",
      cookieNames: this.#cookies.names(),
      interestMarkerDetected,
      loginFormDetected,
      rowMarkerCount: (text.match(/<tr\b/giu) ?? []).length,
      status: response.status
    };
  }

  clearSession(): void {
    this.#cookies.clear();
  }

  private async login(credentials: MatoolCredentials): Promise<void> {
    const body = new URLSearchParams({
      mail: credentials.email,
      pass: credentials.password
    });
    const response = await this.request("/index.php", {
      body,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });

    if (response.status < 200 || response.status >= 400) {
      await response.body?.cancel();
      throw new AppError(
        "matool_login_failed",
        502,
        "Die MATOOL-Anmeldung ist fehlgeschlagen."
      );
    }
    await response.body?.cancel();
  }

  private async request(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    let url = new URL(path, this.#baseUrl);
    assertAllowedMatoolUrl(url);

    let method = init.method ?? "GET";
    let body: BodyInit | null = init.body ?? null;
    const headers = new Headers(init.headers);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const cookie = this.#cookies.headerValue();
      if (cookie) {
        headers.set("Cookie", cookie);
      } else {
        headers.delete("Cookie");
      }

      headers.set("Origin", this.#baseUrl.origin);
      headers.set("Referer", `${this.#baseUrl.origin}/index.php`);

      const response = await this.#fetch(url, {
        ...init,
        body,
        headers,
        method,
        redirect: "manual"
      });
      this.#cookies.absorb(response.headers);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("Location");
      if (!location) {
        throw new AppError(
          "matool_invalid_redirect",
          502,
          "MATOOL hat einen Redirect ohne Ziel geliefert."
        );
      }

      if (redirectCount === 3) {
        throw new AppError(
          "matool_redirect_limit",
          502,
          "MATOOL hat zu viele Redirects geliefert."
        );
      }

      const nextUrl = new URL(location, url);
      assertAllowedMatoolUrl(nextUrl);

      if (response.status === 307 || response.status === 308) {
        throw new AppError(
          "matool_unsafe_redirect",
          502,
          "Ein potenziell unsicherer MATOOL-Redirect wurde abgebrochen."
        );
      }

      await response.body?.cancel();
      url = nextUrl;
      method = "GET";
      body = null;
      headers.delete("Content-Type");
    }

    throw new AppError(
      "matool_redirect_limit",
      502,
      "MATOOL hat zu viele Redirects geliefert."
    );
  }
}

export function validateMatoolBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "invalid_matool_base_url",
      500,
      "Die MATOOL-Basisadresse ist ungültig."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_MATOOL_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      "invalid_matool_base_url",
      500,
      "Die MATOOL-Basisadresse ist nicht freigegeben."
    );
  }

  return url;
}

export function assertAllowedMatoolUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.hostname !== ALLOWED_MATOOL_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new AppError(
      "matool_redirect_blocked",
      502,
      "Ein MATOOL-Redirect zu einem nicht freigegebenen Ziel wurde blockiert."
    );
  }
}

function requireCredentials(credentials: MatoolCredentials): void {
  if (
    credentials.email.trim().length === 0 ||
    credentials.password.length === 0
  ) {
    throw new AppError(
      "matool_credentials_missing",
      500,
      "Die MATOOL-Zugangsdaten sind nicht vollständig konfiguriert."
    );
  }
}
