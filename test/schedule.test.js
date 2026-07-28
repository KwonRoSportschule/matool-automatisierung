import test from "node:test";
import assert from "node:assert/strict";
import { isOperatingTime } from "../src/schedule.js";
import { createWorker } from "../src/worker.js";

const instant = (value) => new Date(value);

test("accepts Berlin boundaries in summer", () => {
  assert.equal(isOperatingTime(instant("2026-07-27T06:00:00Z")), true);
  assert.equal(isOperatingTime(instant("2026-07-27T18:00:00Z")), true);
  assert.equal(isOperatingTime(instant("2026-07-27T19:00:00Z")), false);
});

test("accepts Berlin boundaries in winter", () => {
  assert.equal(isOperatingTime(instant("2026-12-07T06:00:00Z")), false);
  assert.equal(isOperatingTime(instant("2026-12-07T07:00:00Z")), true);
  assert.equal(isOperatingTime(instant("2026-12-07T19:00:00Z")), true);
});

test("rejects weekends and non-hour instants", () => {
  assert.equal(isOperatingTime(instant("2026-07-25T08:00:00Z")), false);
  assert.equal(isOperatingTime(instant("2026-07-27T08:30:00Z")), false);
});

test("invalid trigger exits before login", async () => {
  let logins = 0;
  const worker = createWorker({ loginImpl: async () => { logins += 1; } });
  await worker.scheduled({ scheduledTime: instant("2026-07-27T19:00:00Z").valueOf() }, {});
  assert.equal(logins, 0);
});

test("valid trigger performs exactly one login", async () => {
  let logins = 0;
  const worker = createWorker({ loginImpl: async () => { logins += 1; return () => {}; } });
  await worker.scheduled(
    { scheduledTime: instant("2026-07-27T06:00:00Z").valueOf() },
    { MATOOL_MAIL: "fixture@example.invalid", MATOOL_PASS: "not-a-secret" },
  );
  assert.equal(logins, 1);
});
