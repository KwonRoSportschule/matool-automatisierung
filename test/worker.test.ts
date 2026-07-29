import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/worker";

async function dispatch(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
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
  });

  it("liefert für unbekannte API-Routen einen strukturierten Fehler", async () => {
    const response = await dispatch(
      new Request("http://127.0.0.1/api/admin/v1/unknown")
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
