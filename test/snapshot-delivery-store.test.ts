import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { persistMatoolSnapshotRun } from "../src/worker/matool-store";
import {
  claimNextSnapshotZapierDelivery,
  completeSnapshotZapierDelivery,
  createSnapshotZapierSubscription,
  disableGoneSnapshotZapierSubscription,
  disableSnapshotZapierSubscription,
  retrySnapshotZapierDelivery,
  type SnapshotZapierDeliveryLease
} from "../src/worker/snapshot-delivery-store";

interface SubscriptionStateRow {
  delivery_attempt_count: number;
  last_delivered_change_id: number;
  last_error_code: string | null;
  lease_owner: string | null;
  pending_change_id: number | null;
  status: "active" | "disabled";
}

function testIdentity(): { area: string; suffix: string } {
  const suffix = crypto.randomUUID().replaceAll("-", "_");
  return { area: `interessenten_${suffix}`, suffix };
}

function zapierTargetUrl(label: string, suffix: string): string {
  return [
    "https://hooks.",
    "zapier.com/hooks/catch/",
    label,
    "/",
    suffix
  ].join("");
}

async function persistStatus(
  area: string,
  suffix: string,
  sequence: number,
  sourceId: string,
  status: string
): Promise<void> {
  const timestamp = new Date(
    Date.UTC(2026, 7, 11, 8, sequence, 0)
  ).toISOString();
  await persistMatoolSnapshotRun(env.DB, {
    allowedPayloadFields: ["status"],
    area,
    finishedAt: timestamp,
    observedAt: timestamp,
    records: [{ sourceId, payload: { status } }],
    runId: `run_${suffix}_${sequence}`,
    startedAt: timestamp
  });
}

async function readSubscription(
  subscriptionId: string
): Promise<SubscriptionStateRow> {
  const row = await env.DB
    .prepare(
      `SELECT status,
              last_delivered_change_id,
              pending_change_id,
              delivery_attempt_count,
              lease_owner,
              last_error_code
       FROM zapier_snapshot_subscriptions
       WHERE subscription_id = ?`
    )
    .bind(subscriptionId)
    .first<SubscriptionStateRow>();
  if (!row) {
    throw new Error("synthetic snapshot subscription missing");
  }
  return row;
}

describe("persistente Zapier-Snapshot-Cursor und Leases", () => {
  it("startet am High-Watermark und unterstuetzt mehrere aktive Filter", async () => {
    const { area, suffix } = testIdentity();
    await persistStatus(area, suffix, 1, "900001", "A");

    const all = await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("all", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    const changed = await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: true,
        targetUrl: zapierTargetUrl("changed", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );

    await expect(
      claimNextSnapshotZapierDelivery(
        env.DB,
        "baseline",
        new Date("2026-08-11T08:03:00.000Z"),
        60
      )
    ).resolves.toBeNull();

    await persistStatus(area, suffix, 2, "900002", "A");
    const created = await claimNextSnapshotZapierDelivery(
      env.DB,
      "created",
      new Date("2026-08-11T08:04:00.000Z"),
      60
    );
    expect(created).toMatchObject({
      changeKind: "created",
      payloadJson: '{"status":"A"}',
      subscriptionId: all.id
    });
    expect(created?.eventId).toMatch(/^[a-f0-9]{64}$/u);
    if (!created) {
      throw new Error("synthetic created delivery missing");
    }
    await completeSnapshotZapierDelivery(
      env.DB,
      created,
      new Date("2026-08-11T08:04:01.000Z")
    );

    await persistStatus(area, suffix, 3, "900002", "B");
    const leases: SnapshotZapierDeliveryLease[] = [];
    for (let index = 0; index < 2; index += 1) {
      const lease = await claimNextSnapshotZapierDelivery(
        env.DB,
        `updated_${index}`,
        new Date(`2026-08-11T08:05:0${index}.000Z`),
        60
      );
      if (!lease) {
        throw new Error("synthetic updated delivery missing");
      }
      leases.push(lease);
      await completeSnapshotZapierDelivery(
        env.DB,
        lease,
        new Date(`2026-08-11T08:05:1${index}.000Z`)
      );
    }

    expect(new Set(leases.map((lease) => lease.subscriptionId))).toEqual(
      new Set([all.id, changed.id])
    );
    expect(leases.every((lease) => lease.changeKind === "updated")).toBe(true);
    expect(new Set(leases.map((lease) => lease.eventId)).size).toBe(1);
    expect(leases[0]).toMatchObject({
      area,
      firstSeenAt: "2026-08-11T08:02:00.000Z",
      lastSeenAt: "2026-08-11T08:03:00.000Z",
      observedAt: "2026-08-11T08:03:00.000Z",
      payloadJson: '{"status":"B"}',
      sourceId: "900002"
    });
  });

  it("vergibt bei parallelem Claim genau einen gueltigen Lease", async () => {
    const { area, suffix } = testIdentity();
    await persistStatus(area, suffix, 1, "900010", "A");
    await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("race", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    await persistStatus(area, suffix, 2, "900010", "B");

    const claims = await Promise.all([
      claimNextSnapshotZapierDelivery(
        env.DB,
        "race_a",
        new Date("2026-08-11T08:03:00.000Z"),
        60
      ),
      claimNextSnapshotZapierDelivery(
        env.DB,
        "race_b",
        new Date("2026-08-11T08:03:00.000Z"),
        60
      )
    ]);
    expect(claims.filter((lease) => lease !== null)).toHaveLength(1);
    const winner = claims.find((lease) => lease !== null);
    if (!winner) {
      throw new Error("synthetic winning lease missing");
    }
    await completeSnapshotZapierDelivery(
      env.DB,
      winner,
      new Date("2026-08-11T08:03:01.000Z")
    );
  });

  it("wiederholt nach Retry dasselbe Ereignis und bewegt den Cursor erst nach 2xx", async () => {
    const { area, suffix } = testIdentity();
    await persistStatus(area, suffix, 1, "900020", "A");
    const subscription = await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("retry", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    const baseline = await readSubscription(subscription.id);
    await persistStatus(area, suffix, 2, "900020", "B");

    const first = await claimNextSnapshotZapierDelivery(
      env.DB,
      "retry_first",
      new Date("2026-08-11T08:03:00.000Z"),
      60
    );
    if (!first) {
      throw new Error("synthetic first retry lease missing");
    }
    await retrySnapshotZapierDelivery(
      env.DB,
      first,
      "zapier_http_500",
      new Date("2026-08-11T08:03:01.000Z")
    );
    expect((await readSubscription(subscription.id)).last_delivered_change_id).toBe(
      baseline.last_delivered_change_id
    );
    await expect(
      claimNextSnapshotZapierDelivery(
        env.DB,
        "retry_early",
        new Date("2026-08-11T08:03:20.000Z"),
        60
      )
    ).resolves.toBeNull();

    const second = await claimNextSnapshotZapierDelivery(
      env.DB,
      "retry_second",
      new Date("2026-08-11T08:03:31.000Z"),
      60
    );
    expect(second).toMatchObject({
      attemptNumber: 2,
      changeId: first.changeId,
      deliveryId: first.deliveryId,
      eventId: first.eventId,
      payloadJson: first.payloadJson
    });
    if (!second) {
      throw new Error("synthetic second retry lease missing");
    }
    await completeSnapshotZapierDelivery(
      env.DB,
      second,
      new Date("2026-08-11T08:03:32.000Z")
    );
    expect(await readSubscription(subscription.id)).toMatchObject({
      delivery_attempt_count: 0,
      last_delivered_change_id: first.changeId,
      last_error_code: null,
      lease_owner: null,
      pending_change_id: null,
      status: "active"
    });
  });

  it("reclaimt einen abgelaufenen Lease ohne Ereigniswechsel", async () => {
    const { area, suffix } = testIdentity();
    await persistStatus(area, suffix, 1, "900030", "A");
    await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("expired", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    await persistStatus(area, suffix, 2, "900030", "B");

    const stale = await claimNextSnapshotZapierDelivery(
      env.DB,
      "expired_first",
      new Date("2026-08-11T08:03:00.000Z"),
      30
    );
    const replacement = await claimNextSnapshotZapierDelivery(
      env.DB,
      "expired_second",
      new Date("2026-08-11T08:03:31.000Z"),
      30
    );
    expect(replacement).toMatchObject({
      attemptNumber: 2,
      changeId: stale?.changeId,
      eventId: stale?.eventId
    });
    if (!stale) {
      throw new Error("synthetic stale lease missing");
    }
    await expect(
      completeSnapshotZapierDelivery(
        env.DB,
        stale,
        new Date("2026-08-11T08:03:32.000Z")
      )
    ).rejects.toMatchObject({ code: "snapshot_delivery_lease_lost" });
    if (!replacement) {
      throw new Error("synthetic replacement lease missing");
    }
    await completeSnapshotZapierDelivery(
      env.DB,
      replacement,
      new Date("2026-08-11T08:03:33.000Z")
    );
  });

  it("deaktiviert bei 410 oder Unsubscribe und gibt danach nichts mehr aus", async () => {
    const { area, suffix } = testIdentity();
    await persistStatus(area, suffix, 1, "900040", "A");
    const gone = await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("gone", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    const unsubscribed = await createSnapshotZapierSubscription(
      env.DB,
      {
        area,
        onlyChanged: false,
        targetUrl: zapierTargetUrl("unsubscribe", suffix)
      },
      new Date("2026-08-11T08:02:00.000Z")
    );
    await persistStatus(area, suffix, 2, "900040", "B");

    const lease = await claimNextSnapshotZapierDelivery(
      env.DB,
      "gone",
      new Date("2026-08-11T08:03:00.000Z"),
      60
    );
    if (!lease) {
      throw new Error("synthetic gone lease missing");
    }
    await disableGoneSnapshotZapierSubscription(
      env.DB,
      lease,
      new Date("2026-08-11T08:03:01.000Z")
    );
    expect(await readSubscription(lease.subscriptionId)).toMatchObject({
      last_error_code: "zapier_subscription_gone",
      status: "disabled"
    });

    const otherId =
      lease.subscriptionId === gone.id ? unsubscribed.id : gone.id;
    await expect(
      disableSnapshotZapierSubscription(
        env.DB,
        otherId,
        new Date("2026-08-11T08:03:02.000Z")
      )
    ).resolves.toBe(true);
    await expect(
      claimNextSnapshotZapierDelivery(
        env.DB,
        "after_disable",
        new Date("2026-08-11T08:04:00.000Z"),
        60
      )
    ).resolves.toBeNull();
  });
});
