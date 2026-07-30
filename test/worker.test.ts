import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { MatoolClient } from "../src/matool/client";
import worker from "../src/worker";
import type { Env } from "../src/worker/env";

async function dispatch(
  request: Request,
  runtimeEnv: Env = env
): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, runtimeEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

describe("Worker-Grenzen", () => {
  it("liefert einen minimalen öffentlichen Healthcheck", async () => {
    const response = await dispatch(
      new Request("https://example.invalid/healthz")
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      schemaVersion: 1,
      service: "matool-middleware-hub",
      status: "ok"
    });
    expect(JSON.stringify(payload)).not.toContain("database");
  });

  it("schützt selbst statische Routen mit Cloudflare Access", async () => {
    const response = await dispatch(
      new Request("https://example.invalid/")
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "access_denied" }
    });
  });

  it("gibt im öffentlichen Staging nur Dashboard-Lesezugriffe frei", async () => {
    const context = createExecutionContext();
    const publicEnv = {
      ...env,
      APP_ENV: "staging",
      PUBLIC_DASHBOARD_READ_ONLY: "true"
    } as Env;
    const status = await worker.fetch(
      new Request(
        "https://matool-middleware-staging.example.invalid/api/admin/v1/status"
      ),
      publicEnv,
      context
    );
    expect(status.status).toBe(200);

    const csrf = await worker.fetch(
      new Request(
        "https://matool-middleware-staging.example.invalid/api/admin/v1/csrf"
      ),
      publicEnv,
      context
    );
    expect(csrf.status).toBe(403);
    await waitOnExecutionContext(context);
  });

  it("liefert lokal nur aggregierten Prozessstatus", async () => {
    const response = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/status")
    );
    const payload = (await response.json()) as {
      connections: { zapier: { plan: string } };
      process: { mode: string };
    };

    expect(response.status).toBe(200);
    expect(payload.process.mode).toBe("disabled");
    expect(payload.connections.zapier.plan).toBe("Professional");
    expect(JSON.stringify(payload)).not.toContain("example.invalid");
  });

  it("bindet CSRF-Tokens an Ursprung und Mitarbeiteridentität", async () => {
    const tokenResponse = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/csrf")
    );
    const tokenPayload = (await tokenResponse.json()) as { token: string };

    const rejected = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/sync/dry-run", {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.invalid",
          "X-CSRF-Token": tokenPayload.token
        },
        method: "POST"
      })
    );
    expect(rejected.status).toBe(403);

    const acceptedSecurityBoundary = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/sync/dry-run", {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1",
          "X-CSRF-Token": tokenPayload.token
        },
        method: "POST"
      })
    );
    expect(acceptedSecurityBoundary.status).toBe(409);
    await expect(acceptedSecurityBoundary.json()).resolves.toMatchObject({
      error: { code: "matool_not_configured" }
    });

    const probeWithoutSecrets = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/matool/probe", {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1",
          "X-CSRF-Token": tokenPayload.token
        },
        method: "POST"
      })
    );
    expect(probeWithoutSecrets.status).toBe(409);
    await expect(probeWithoutSecrets.json()).resolves.toMatchObject({
      error: { code: "matool_not_configured" }
    });

    const discoveryWithoutSecrets = await dispatch(
      new Request(
        "http://127.0.0.1/api/admin/v1/matool/discovery",
        {
          body: JSON.stringify({ bereich: "interessenten" }),
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1",
            "X-CSRF-Token": tokenPayload.token
          },
          method: "POST"
        }
      )
    );
    expect(discoveryWithoutSecrets.status).toBe(409);
    await expect(discoveryWithoutSecrets.json()).resolves.toMatchObject({
      error: { code: "matool_not_configured" }
    });
  });

  it("schützt die MATOOL-Discovery mit Mitarbeiterzugriff und CSRF", async () => {
    const configuredEnv = {
      ...env,
      MATOOL_EMAIL: "worker-test@example.invalid",
      MATOOL_PASSWORD: "test-only-password",
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only"
    } as Env;
    const discover = vi.spyOn(
      MatoolClient.prototype,
      "discoverStructure"
    ).mockRejectedValue(new Error("unexpected MATOOL request"));

    const withoutEmployeeAccess = await dispatch(
      new Request(
        "https://example.invalid/api/admin/v1/matool/discovery",
        {
          body: JSON.stringify({ bereich: "interessenten" }),
          headers: {
            "Content-Type": "application/json",
            Origin: "https://example.invalid"
          },
          method: "POST"
        }
      ),
      configuredEnv
    );
    expect(withoutEmployeeAccess.status).toBe(403);

    const withoutCsrf = await dispatch(
      new Request(
        "http://127.0.0.1/api/admin/v1/matool/discovery",
        {
          body: JSON.stringify({ bereich: "interessenten" }),
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1"
          },
          method: "POST"
        }
      ),
      configuredEnv
    );
    expect(withoutCsrf.status).toBe(403);
    expect(discover).not.toHaveBeenCalled();
    discover.mockRestore();
  });

  it("weist ungültige Discovery-Bereiche und Request-Bodies ohne MATOOL-Aufruf ab", async () => {
    const tokenResponse = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/csrf")
    );
    const { token } = (await tokenResponse.json()) as { token: string };
    const discover = vi.spyOn(
      MatoolClient.prototype,
      "discoverStructure"
    ).mockRejectedValue(new Error("unexpected MATOOL request"));
    const invalidRequests = [
      {
        body: "{",
        code: "invalid_matool_body"
      },
      {
        body: JSON.stringify({}),
        code: "invalid_matool_body"
      },
      {
        body: JSON.stringify({
          bereich: "interessenten",
          unexpected: true
        }),
        code: "invalid_matool_body"
      },
      {
        body: JSON.stringify({ bereich: "schueler" }),
        code: "invalid_matool_bereich"
      }
    ];

    for (const testCase of invalidRequests) {
      const response = await dispatch(
        new Request(
          "http://127.0.0.1/api/admin/v1/matool/discovery",
          {
            body: testCase.body,
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1",
              "X-CSRF-Token": token
            },
            method: "POST"
          }
        )
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: testCase.code }
      });
    }

    expect(discover).not.toHaveBeenCalled();
    discover.mockRestore();
  });

  it("liefert ausschließlich die aggregierte Interessenten-Struktur", async () => {
    const configuredEnv = {
      ...env,
      MATOOL_EMAIL: "worker-test@example.invalid",
      MATOOL_PASSWORD: "test-only-password",
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only"
    } as Env;
    const discovery = {
      bereich: "interessenten" as const,
      bodyBytes: 4567,
      fields: [
        {
          element: "select" as const,
          name: "standort",
          optionCount: 2
        }
      ],
      idPatterns: [
        {
          attribute: "onclick" as const,
          occurrences: 3,
          pattern: "open_interest(<id>)"
        }
      ],
      rowCount: 3,
      status: 200,
      tableCount: 1,
      tables: [
        {
          headers: ["Nummer", "Probetraining"],
          index: 0,
          rowCount: 3
        }
      ]
    };
    const discover = vi
      .spyOn(MatoolClient.prototype, "discoverStructure")
      .mockResolvedValue(discovery);
    const tokenResponse = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/csrf"),
      configuredEnv
    );
    const { token } = (await tokenResponse.json()) as { token: string };

    const response = await dispatch(
      new Request(
        "http://127.0.0.1/api/admin/v1/matool/discovery",
        {
          body: JSON.stringify({ bereich: "interessenten" }),
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1",
            "X-CSRF-Token": token
          },
          method: "POST"
        }
      ),
      configuredEnv
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      discovery,
      schemaVersion: 1
    });
    expect(discover).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledWith(
      {
        email: configuredEnv.MATOOL_EMAIL,
        password: configuredEnv.MATOOL_PASSWORD
      },
      "interessenten"
    );
    expect(JSON.stringify(payload)).not.toContain(
      configuredEnv.MATOOL_PASSWORD
    );
    expect(JSON.stringify(payload)).not.toContain("<table");
    discover.mockRestore();
  });

  it("liefert den geschützten Interessenten-Datenauszug", async () => {
    const configuredEnv = {
      ...env,
      MATOOL_EMAIL: "worker-test@example.invalid",
      MATOOL_PASSWORD: "test-only-password",
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only"
    } as Env;
    const extraction = [
      {
        sourceId: "4711",
        displayNumber: "17",
        createdDate: "01.02.2026",
        firstName: "Test",
        lastName: "Person",
        status: "Neu"
      }
    ];
    const extract = vi
      .spyOn(MatoolClient.prototype, "extractInteressenten")
      .mockResolvedValue(extraction);
    const tokenResponse = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/csrf"),
      configuredEnv
    );
    const { token } = (await tokenResponse.json()) as { token: string };

    const response = await dispatch(
      new Request(
        "http://127.0.0.1/api/admin/v1/matool/interessenten/extract",
        {
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1",
            "X-CSRF-Token": token
          },
          method: "POST"
        }
      ),
      configuredEnv
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      extraction,
      schemaVersion: 1
    });
    expect(extract).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledWith({
      email: configuredEnv.MATOOL_EMAIL,
      password: configuredEnv.MATOOL_PASSWORD
    });
    expect(JSON.stringify(payload)).not.toContain(
      configuredEnv.MATOOL_PASSWORD
    );
    extract.mockRestore();
  });

  it("weist falsche Methode und nicht-leere Auszugs-Bodies vor dem MATOOL-Aufruf ab", async () => {
    const configuredEnv = {
      ...env,
      MATOOL_EMAIL: "worker-test@example.invalid",
      MATOOL_PASSWORD: "test-only-password",
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only"
    } as Env;
    const extract = vi
      .spyOn(MatoolClient.prototype, "extractInteressenten")
      .mockRejectedValue(new Error("unexpected MATOOL request"));
    const tokenResponse = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/csrf"),
      configuredEnv
    );
    const { token } = (await tokenResponse.json()) as { token: string };

    const wrongMethod = await dispatch(
      new Request(
        "http://127.0.0.1/api/admin/v1/matool/interessenten/extract",
        { method: "GET" }
      ),
      configuredEnv
    );
    expect(wrongMethod.status).toBe(405);
    await expect(wrongMethod.json()).resolves.toMatchObject({
      error: { code: "method_not_allowed" }
    });

    for (const body of ["{", "null", "[]", '{"unexpected":true}']) {
      const response = await dispatch(
        new Request(
          "http://127.0.0.1/api/admin/v1/matool/interessenten/extract",
          {
            body,
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1",
              "X-CSRF-Token": token
            },
            method: "POST"
          }
        ),
        configuredEnv
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_matool_extract_body" }
      });
    }

    expect(extract).not.toHaveBeenCalled();
    extract.mockRestore();
  });

  it("blockiert den Auszug ohne MATOOL-Konfiguration oder read-only-Freigabe", async () => {
    const extract = vi
      .spyOn(MatoolClient.prototype, "extractInteressenten")
      .mockRejectedValue(new Error("unexpected MATOOL request"));
    const missingConfigurationEnv = {
      ...env,
      MATOOL_EMAIL: undefined,
      MATOOL_PASSWORD: undefined,
      MATOOL_REAL_RUNS_ENABLED: "confirmed-read-only"
    } as unknown as Env;
    const unconfirmedEnv = {
      ...env,
      MATOOL_EMAIL: "worker-test@example.invalid",
      MATOOL_PASSWORD: "test-only-password",
      MATOOL_REAL_RUNS_ENABLED: "false"
    } as Env;

    for (const testCase of [
      {
        code: "matool_not_configured",
        runtimeEnv: missingConfigurationEnv
      },
      {
        code: "matool_runs_not_confirmed",
        runtimeEnv: unconfirmedEnv
      }
    ]) {
      const tokenResponse = await dispatch(
        new Request("http://127.0.0.1/api/admin/v1/csrf"),
        testCase.runtimeEnv
      );
      const { token } = (await tokenResponse.json()) as {
        token: string;
      };
      const response = await dispatch(
        new Request(
          "http://127.0.0.1/api/admin/v1/matool/interessenten/extract",
          {
            body: "{}",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1",
              "X-CSRF-Token": token
            },
            method: "POST"
          }
        ),
        testCase.runtimeEnv
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: testCase.code }
      });
    }

    expect(extract).not.toHaveBeenCalled();
    extract.mockRestore();
  });

  it("liefert für unbekannte API-Routen einen strukturierten Fehler", async () => {
    const response = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/unknown")
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
