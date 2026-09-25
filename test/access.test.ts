import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  accessIdentityFromPayload,
  dashboardAccessSummary,
  normalizeAccessTeamDomain,
  requireAccessIdentity
} from "../src/worker/access";
import type { Env } from "../src/worker/env";
import {
  LOGIN_MAX_FAILURES,
  LoginLockedError,
  loginThrottleBucket
} from "../src/worker/login-throttle";

describe("Cloudflare-Access-Konfiguration", () => {
  it("kennzeichnet die oeffentliche Ansicht als nicht verwaltbar", () => {
    expect(
      dashboardAccessSummary({
        authentication: "public-read-only",
        subject: "public-dashboard-read-only"
      })
    ).toMatchObject({
      authentication: "public-read-only",
      canManage: false
    });
  });

  it.each([
    "cloudflare-access",
    "local-development",
    "public-full-access"
  ] as const)(
    "gibt geschuetzte Aktionen fuer %s frei",
    (authentication) => {
      expect(
        dashboardAccessSummary({
          authentication,
          subject: "synthetic-employee"
        })
      ).toMatchObject({ authentication, canManage: true });
    }
  );

  it.each([
    ["GET", "/"],
    ["GET", "/api/admin/v1/csrf"],
    ["POST", "/api/admin/v1/matool/sync"]
  ])("erlaubt mit Vollzugriff %s %s ohne Anmeldung", async (method, path) => {
    const identity = await requireAccessIdentity(
      new Request(`https://middleware.example.invalid${path}`, { method }),
      {
        APP_ENV: "staging",
        PUBLIC_DASHBOARD_FULL_ACCESS: "true"
      } as Env
    );
    expect(identity).toEqual({
      authentication: "public-full-access",
      subject: "public-dashboard-full-access"
    });
  });

  it("lässt die Zapier-Service-API trotz öffentlichem Dashboard geschützt", async () => {
    await expect(
      requireAccessIdentity(
        new Request("https://middleware.example.invalid/api/zapier/v1/account"),
        {
          ACCESS_AUD: "configure-with-cloudflare-access",
          ACCESS_SERVICE_AUD: "configure-with-cloudflare-access-service-app",
          ACCESS_TEAM_DOMAIN: "configure-with-cloudflare-access",
          APP_ENV: "staging",
          PUBLIC_DASHBOARD_FULL_ACCESS: "true"
        } as Env,
        "zapier-service"
      )
    ).rejects.toMatchObject({ code: "access_not_configured" });
  });

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

describe("Dashboard-Passwortschutz", () => {
  const passwordEnv = {
    ...env,
    APP_ENV: "staging",
    DASHBOARD_PASSWORD: "synthetisches-Passwort-äöü",
    DASHBOARD_PASSWORD_REQUIRED: "true",
    DASHBOARD_USERNAME: "synthetic-trainer",
    PUBLIC_DASHBOARD_FULL_ACCESS: "true",
    PUBLIC_DASHBOARD_READ_ONLY: "true"
  } as Env;

  function basicAuthorization(username: string, password: string): string {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    return `Basic ${btoa(String.fromCharCode(...bytes))}`;
  }

  /** Jede Anfrage bekommt eine eigene Herkunft, sonst teilen Tests die Sperre. */
  function dashboardRequest(
    authorization?: string,
    origin = syntheticOrigin()
  ): Request {
    return new Request("https://middleware.example.invalid/", {
      headers: {
        "CF-Connecting-IP": origin,
        ...(authorization ? { Authorization: authorization } : {})
      }
    });
  }

  function syntheticOrigin(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(2));
    return `198.51.${bytes[0]}.${bytes[1]}`;
  }

  const correct = () =>
    basicAuthorization("synthetic-trainer", "synthetisches-Passwort-äöü");
  const wrong = () =>
    basicAuthorization("synthetic-trainer", "falsches-Passwort-123");

  it("meldet mit korrekten Zugangsdaten an und erlaubt Mitarbeiteraktionen", async () => {
    const identity = await requireAccessIdentity(
      dashboardRequest(correct()),
      passwordEnv
    );
    expect(identity).toEqual({
      authentication: "dashboard-password",
      subject: "dashboard-password:synthetic-trainer"
    });
    expect(dashboardAccessSummary(identity).canManage).toBe(true);
  });

  it.each([
    ["ohne Zugangsdaten", undefined],
    [
      "mit falschem Passwort",
      basicAuthorization("synthetic-trainer", "falsches-Passwort-123")
    ],
    [
      "mit falschem Benutzernamen",
      basicAuthorization("someone-else", "synthetisches-Passwort-äöü")
    ],
    ["mit kaputtem Header", "Basic !!!"],
    ["mit Bearer-Token", "Bearer synthetic-token"]
  ])("verlangt %s eine Anmeldung trotz oeffentlicher Modi", async (_label, authorization) => {
    await expect(
      requireAccessIdentity(dashboardRequest(authorization), passwordEnv)
    ).rejects.toMatchObject({ code: "dashboard_login_required", status: 401 });
  });

  it.each([
    ["ohne Secrets", {}],
    ["mit zu kurzem Passwort", { DASHBOARD_USERNAME: "trainer", DASHBOARD_PASSWORD: "kurz" }],
    ["nur mit Benutzername", { DASHBOARD_USERNAME: "trainer" }],
    [
      "mit Doppelpunkt im Benutzernamen",
      { DASHBOARD_USERNAME: "trai:ner", DASHBOARD_PASSWORD: "synthetisches-Passwort" }
    ]
  ])("bleibt %s gesperrt", async (_label, secrets) => {
    await expect(
      requireAccessIdentity(dashboardRequest(), {
        APP_ENV: "staging",
        DASHBOARD_PASSWORD_REQUIRED: "true",
        PUBLIC_DASHBOARD_FULL_ACCESS: "true",
        ...secrets
      } as Env)
    ).rejects.toMatchObject({
      code: "dashboard_password_not_configured",
      status: 503
    });
  });

  it("aktiviert den Schutz auch ohne Pflichtschalter, sobald Secrets gesetzt sind", async () => {
    await expect(
      requireAccessIdentity(dashboardRequest(), {
        APP_ENV: "staging",
        DASHBOARD_PASSWORD: "synthetisches-Passwort",
        DASHBOARD_USERNAME: "synthetic-trainer",
        PUBLIC_DASHBOARD_FULL_ACCESS: "true"
      } as Env)
    ).rejects.toMatchObject({ code: "dashboard_login_required" });
  });

  it("gilt nicht fuer die Zapier-Service-Pruefung", async () => {
    await expect(
      requireAccessIdentity(
        new Request("https://middleware.example.invalid/api/zapier/v1/account"),
        {
          ...passwordEnv,
          ACCESS_AUD: "configure-with-cloudflare-access",
          ACCESS_SERVICE_AUD: "configure-with-cloudflare-access-service-app",
          ACCESS_TEAM_DOMAIN: "configure-with-cloudflare-access"
        } as Env,
        "zapier-service"
      )
    ).rejects.toMatchObject({ code: "access_not_configured" });
  });

  it("sperrt eine Herkunft nach zehn Fehlversuchen, auch fuer richtige Zugangsdaten", async () => {
    const origin = syntheticOrigin();
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      await expect(
        requireAccessIdentity(dashboardRequest(wrong(), origin), passwordEnv)
      ).rejects.toMatchObject({ code: "dashboard_login_required" });
    }

    const locked = requireAccessIdentity(
      dashboardRequest(correct(), origin),
      passwordEnv
    );
    await expect(locked).rejects.toBeInstanceOf(LoginLockedError);
    await expect(locked).rejects.toMatchObject({
      code: "dashboard_login_locked",
      status: 429
    });

    // Andere Herkunft bleibt unberuehrt.
    await expect(
      requireAccessIdentity(dashboardRequest(correct()), passwordEnv)
    ).resolves.toMatchObject({ authentication: "dashboard-password" });
  });

  it("hebt die Sperre nach Ablauf auf und setzt den Zaehler nach Erfolg zurueck", async () => {
    const origin = syntheticOrigin();
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      await expect(
        requireAccessIdentity(dashboardRequest(wrong(), origin), passwordEnv)
      ).rejects.toMatchObject({ code: "dashboard_login_required" });
    }
    const bucket = await loginThrottleBucket(
      dashboardRequest(undefined, origin),
      passwordEnv
    );
    const row = await env.DB.prepare(
      "SELECT failure_count, locked_until FROM dashboard_login_throttle WHERE bucket = ?"
    )
      .bind(bucket)
      .first<{ failure_count: number; locked_until: number }>();
    expect(row?.failure_count).toBe(LOGIN_MAX_FAILURES);
    expect(row?.locked_until).toBeGreaterThan(Date.now() / 1000);
    // Gespeichert ist nur ein HMAC, nie die Adresse selbst.
    expect(bucket).not.toContain(origin);

    await env.DB.prepare(
      `UPDATE dashboard_login_throttle
       SET locked_until = ?, window_started_at = ?
       WHERE bucket = ?`
    )
      .bind(Math.floor(Date.now() / 1000) - 1, 0, bucket)
      .run();

    await expect(
      requireAccessIdentity(dashboardRequest(correct(), origin), passwordEnv)
    ).resolves.toMatchObject({ authentication: "dashboard-password" });
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM dashboard_login_throttle WHERE bucket = ?")
        .bind(bucket)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });

  it("verlangt als zweiten Faktor zuerst Cloudflare Access", async () => {
    const origin = syntheticOrigin();
    await expect(
      requireAccessIdentity(dashboardRequest(correct(), origin), {
        ...passwordEnv,
        ACCESS_AUD: "synthetic-employee-audience",
        ACCESS_SERVICE_AUD: "synthetic-service-audience",
        ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com",
        DASHBOARD_REQUIRE_CLOUDFLARE_ACCESS: "true"
      } as Env)
    ).rejects.toMatchObject({ code: "access_denied", status: 403 });

    // Ohne Access-Anmeldung wird kein Passwortversuch gezaehlt.
    const bucket = await loginThrottleBucket(
      dashboardRequest(undefined, origin),
      passwordEnv
    );
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM dashboard_login_throttle WHERE bucket = ?")
        .bind(bucket)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 0 });
  });
});
