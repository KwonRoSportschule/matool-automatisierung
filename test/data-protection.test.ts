import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { runDataProtectionMaintenance } from "../src/worker/data-protection";
import type { Env } from "../src/worker/env";
import { pruneLoginThrottle } from "../src/worker/login-throttle";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

const SECOND_KEY = "synthetic-second-data-encryption-key-for-rotation";

/** Speichert so, wie es vor der Verschluesselung geschah: im Klartext. */
const legacyEnv = {
  ...env,
  DATA_ENCRYPTION_KEY: undefined,
  DATA_ENCRYPTION_REQUIRED: "false"
} as unknown as Env;

function testArea(): { area: string; suffix: string } {
  const suffix = crypto.randomUUID().replaceAll("-", "_");
  return { area: `schutz_${suffix}`, suffix };
}

async function persistPayload(
  runtimeEnv: Env,
  area: string,
  runId: string,
  sourceId: string,
  payload: Record<string, string>,
  observedAt = new Date().toISOString()
): Promise<void> {
  await persistMatoolSnapshotRun(
    runtimeEnv.DB,
    {
      allowedPayloadFields: Object.keys(payload),
      area,
      finishedAt: observedAt,
      observedAt,
      records: [{ sourceId, payload }],
      runId,
      startedAt: observedAt
    },
    await storedPayloadCipher(runtimeEnv)
  );
}

async function storedPayloads(
  area: string
): Promise<{ changes: (string | null)[]; snapshot: string | undefined }> {
  const snapshot = await env.DB.prepare(
    "SELECT payload_json FROM matool_snapshots WHERE area = ?"
  )
    .bind(area)
    .first<{ payload_json: string }>();
  const changes = await env.DB.prepare(
    `SELECT payload_json FROM matool_snapshot_changes
     WHERE area = ? ORDER BY change_id`
  )
    .bind(area)
    .all<{ payload_json: string | null }>();
  return {
    changes: changes.results.map((row) => row.payload_json),
    snapshot: snapshot?.payload_json
  };
}

describe("Verschluesselung gespeicherter Personendaten", () => {
  it("speichert Personendaten nur als AES-GCM-Chiffrat mit zufaelligem IV", async () => {
    const { area, suffix } = testArea();
    const payload = { iban: "DE02120300000000202051", name: "Synthetisch" };
    await persistPayload(env, area, `run_${suffix}`, "4711", payload);

    const stored = await storedPayloads(area);
    expect(stored.snapshot).toMatch(/^enc:v1:[0-9a-f]{16}:/u);
    expect(stored.snapshot).not.toContain("DE02");
    expect(stored.snapshot).not.toContain("Synthetisch");

    const cipher = await storedPayloadCipher(env);
    const context = { area, sourceId: "4711" };
    const plaintext = JSON.stringify(payload);
    const first = await cipher.seal(context, plaintext);
    const second = await cipher.seal(context, plaintext);
    expect(first).not.toBe(second);
    await expect(cipher.open(context, first)).resolves.toBe(plaintext);
  });

  it("bindet das Chiffrat an Bereich und Datensatz", async () => {
    const cipher = await storedPayloadCipher(env);
    const sealed = await cipher.seal(
      { area: "schueler_details", sourceId: "1" },
      '{"iban":"DE02120300000000202051"}'
    );
    await expect(
      cipher.open({ area: "schueler_details", sourceId: "2" }, sealed)
    ).rejects.toMatchObject({ code: "stored_payload_unreadable" });
    await expect(
      cipher.open({ area: "interessenten", sourceId: "1" }, sealed)
    ).rejects.toMatchObject({ code: "stored_payload_unreadable" });

    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "AB" : "AA"}`;
    await expect(
      cipher.open({ area: "schueler_details", sourceId: "1" }, tampered)
    ).rejects.toMatchObject({ code: "stored_payload_unreadable" });
  });

  it("verweigert das Speichern ohne Schluessel, wenn Verschluesselung Pflicht ist", async () => {
    const { area, suffix } = testArea();
    await expect(
      persistPayload(
        { ...legacyEnv, DATA_ENCRYPTION_REQUIRED: "true" } as Env,
        area,
        `run_${suffix}`,
        "1",
        { name: "Synthetisch" }
      )
    ).rejects.toMatchObject({ code: "data_encryption_not_configured" });
    await expect(storedPayloads(area)).resolves.toEqual({
      changes: [],
      snapshot: undefined
    });
  });

  it("lehnt zu kurze Schluessel ab", async () => {
    await expect(
      storedPayloadCipher({ ...env, DATA_ENCRYPTION_KEY: "zu-kurz" } as Env)
    ).rejects.toMatchObject({ code: "data_encryption_key_invalid" });
  });
});

describe("Wartungslauf Datenschutz", () => {
  it("verschluesselt Klartext-Altbestand in Snapshots und Historie", async () => {
    const { area, suffix } = testArea();
    await persistPayload(legacyEnv, area, `run_${suffix}`, "1", {
      name: "Altbestand"
    });
    const before = await storedPayloads(area);
    expect(before.snapshot).toBe('{"name":"Altbestand"}');

    // Klartext bleibt waehrend der Umstellung lesbar.
    const cipher = await storedPayloadCipher(env);
    await expect(
      cipher.open({ area, sourceId: "1" }, before.snapshot ?? "")
    ).resolves.toBe('{"name":"Altbestand"}');

    const result = await runDataProtectionMaintenance(env);
    expect(result).toMatchObject({
      encryptionConfigured: true,
      unprotectedPayloads: 0
    });
    expect(result.sealedPayloads).toBeGreaterThanOrEqual(2);

    const after = await storedPayloads(area);
    expect(after.snapshot).toMatch(/^enc:v1:/u);
    expect(after.changes).toHaveLength(1);
    expect(after.changes[0]).toMatch(/^enc:v1:/u);
    await expect(
      cipher.open({ area, sourceId: "1" }, after.snapshot ?? "")
    ).resolves.toBe('{"name":"Altbestand"}');
  });

  it("versiegelt nach einem Schluesselwechsel alles mit dem neuen Schluessel", async () => {
    const { area, suffix } = testArea();
    await persistPayload(env, area, `run_${suffix}`, "1", { name: "Rotation" });
    const oldHeader = (await storedPayloads(area)).snapshot?.slice(0, 24);

    const rotatedEnv = {
      ...env,
      DATA_ENCRYPTION_KEY: SECOND_KEY,
      DATA_ENCRYPTION_KEY_PREVIOUS: env.DATA_ENCRYPTION_KEY
    } as Env;
    // Ohne vorherigen Schluessel bleibt Altes unlesbar statt still leer.
    const withoutPrevious = await storedPayloadCipher({
      ...env,
      DATA_ENCRYPTION_KEY: SECOND_KEY
    } as Env);
    await expect(
      withoutPrevious.open(
        { area, sourceId: "1" },
        (await storedPayloads(area)).snapshot ?? ""
      )
    ).rejects.toMatchObject({ code: "stored_payload_unreadable" });

    await runDataProtectionMaintenance(rotatedEnv);
    const after = await storedPayloads(area);
    expect(after.snapshot?.slice(0, 24)).not.toBe(oldHeader);
    await expect(
      withoutPrevious.open({ area, sourceId: "1" }, after.snapshot ?? "")
    ).resolves.toBe('{"name":"Rotation"}');

    // Zurueck auf den Testschluessel, damit andere Tests lesbar bleiben.
    await runDataProtectionMaintenance({
      ...env,
      DATA_ENCRYPTION_KEY_PREVIOUS: SECOND_KEY
    } as Env);
  });

  it("loescht alte Datensatzstaende aus der Historie, nicht aber die Metadaten", async () => {
    const { area, suffix } = testArea();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await persistPayload(env, area, `run_${suffix}_1`, "1", { status: "A" }, old);
    await persistPayload(env, area, `run_${suffix}_2`, "1", { status: "B" });

    const result = await runDataProtectionMaintenance(env);
    expect(result.expiredChangePayloads).toBeGreaterThanOrEqual(1);

    const after = await storedPayloads(area);
    expect(after.changes).toHaveLength(2);
    expect(after.changes[0]).toBeNull();
    expect(after.changes[1]).toMatch(/^enc:v1:/u);
    // Der aktuelle Stand bleibt vollstaendig erhalten.
    expect(after.snapshot).toMatch(/^enc:v1:/u);
  });

  it("haelt die Loeschfrist konfigurierbar", async () => {
    const { area, suffix } = testArea();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await persistPayload(env, area, `run_${suffix}`, "1", { status: "A" }, old);

    await runDataProtectionMaintenance({
      ...env,
      CHANGE_PAYLOAD_RETENTION_DAYS: "60"
    } as Env);
    expect((await storedPayloads(area)).changes[0]).toMatch(/^enc:v1:/u);
  });

  it("raeumt abgelaufene Eintraege der Login-Sperre auf", async () => {
    const now = Math.floor(Date.now() / 1000);
    await pruneLoginThrottle(env.DB, now);
    await env.DB.prepare(
      `INSERT INTO dashboard_login_throttle
         (bucket, failure_count, window_started_at, locked_until, updated_at)
       VALUES ('alt', 3, ?, NULL, ?), ('aktiv', 3, ?, ?, ?)`
    )
      .bind(now - 90_000, now - 90_000, now - 90_000, now + 600, now - 90_000)
      .run();

    await expect(pruneLoginThrottle(env.DB, now)).resolves.toBe(1);
    const remaining = await env.DB.prepare(
      "SELECT bucket FROM dashboard_login_throttle WHERE bucket IN ('alt', 'aktiv')"
    ).all<{ bucket: string }>();
    expect(remaining.results).toEqual([{ bucket: "aktiv" }]);
  });
});
