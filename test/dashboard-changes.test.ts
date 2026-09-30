import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { getDashboardRecord } from "../src/worker/dashboard-repository";
import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import { storedPayloadCipher } from "../src/worker/payload-encryption";

interface HistoryEntry {
  change: string;
  fieldChanges: Array<{
    after: string | null;
    before: string | null;
    key: string;
    masked: boolean;
  }> | null;
}

async function save(
  sourceId: string,
  suffix: string,
  payload: Record<string, string>,
  observedAt: string
): Promise<void> {
  await persistMatoolSnapshotRun(
    env.DB,
    {
      allowedPayloadFields: Object.keys(payload),
      area: "schueler",
      finishedAt: observedAt,
      observedAt,
      records: [{ sourceId, payload }],
      runId: `run_${suffix}_${observedAt.slice(8, 10)}`,
      startedAt: observedAt
    },
    await storedPayloadCipher(env)
  );
}

describe("Dashboard: Aenderungen eines Datensatzes", () => {
  it("nennt geaenderte Felder mit alt und neu, geschuetzte ohne Werte", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const sourceId = `chg${suffix.slice(0, 12)}`;
    await save(
      sourceId,
      suffix,
      { ort: "Alt-Ort", iban: "DE02120300000000202051", vorname: "Anna" },
      "2026-09-01T10:00:00.000Z"
    );
    await save(
      sourceId,
      suffix,
      { ort: "Neu-Ort", iban: "DE89370400440532013000", vorname: "Anna" },
      "2026-09-02T10:00:00.000Z"
    );

    const snapshot = await env.DB.prepare(
      "SELECT public_id FROM matool_snapshots WHERE area = 'schueler' AND source_id = ?"
    )
      .bind(sourceId)
      .first<{ public_id: string }>();
    const load = async (plaintext: "true" | "false") =>
      (await getDashboardRecord(
        { ...env, PUBLIC_DASHBOARD_PLAINTEXT: plaintext },
        "schueler",
        snapshot?.public_id ?? ""
      )) as { changeHistory: HistoryEntry[] };

    const detail = await load("true");
    const updated = detail.changeHistory.find((entry) => entry.change === "updated");
    expect(updated?.fieldChanges).not.toBeNull();
    const byKey = new Map(updated?.fieldChanges?.map((c) => [c.key, c]));
    expect(byKey.get("ort")).toMatchObject({ before: "Alt-Ort", after: "Neu-Ort", masked: false });
    expect(byKey.has("vorname")).toBe(false);
    // Auch im Klartextbetrieb nur die letzten vier IBAN-Stellen.
    expect(byKey.get("iban")).toMatchObject({ before: "•••• 2051", after: "•••• 3000" });

    const hidden = await load("false");
    const hiddenChanges = hidden.changeHistory.find((entry) => entry.change === "updated")
      ?.fieldChanges;
    expect(hiddenChanges?.find((c) => c.key === "ort")).toMatchObject({
      masked: true,
      before: null,
      after: null
    });
    const text = JSON.stringify(hidden);
    for (const secret of ["Alt-Ort", "Neu-Ort", "DE02120300000000202051", "DE89370400440532013000"]) {
      expect(text).not.toContain(secret);
    }

    const created = detail.changeHistory.find((entry) => entry.change === "created");
    expect(created?.fieldChanges).toBeNull();
  });
});
