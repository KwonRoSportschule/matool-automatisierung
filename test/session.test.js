import test from "node:test";
import assert from "node:assert/strict";
import { login } from "../src/session.js";

test("initializes a session, logs in once, and reuses its cookie", async () => {
  const calls = [];
  const responses = [
    new Response("", { status: 200, headers: { "set-cookie": "PHPSESSID=test-session; Path=/; HttpOnly" } }),
    new Response("", { status: 302, headers: { location: "/index.php" } }),
    new Response("fixture", { status: 200 }),
  ];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responses.shift();
  };

  const authenticatedFetch = await login({
    mail: "fixture@example.invalid",
    password: "fixture-password",
    fetchImpl,
  });
  await authenticatedFetch("/index.php?show=interessenten");

  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.redirect, "manual");
  assert.equal(calls[1].init.headers.cookie, "PHPSESSID=test-session");
  assert.equal(new Headers(calls[2].init.headers).get("cookie"), "PHPSESSID=test-session");
});

test("fails closed when login does not redirect", async () => {
  const responses = [new Response("", { status: 200 }), new Response("login", { status: 200 })];
  await assert.rejects(
    login({ mail: "x", password: "y", fetchImpl: async () => responses.shift() }),
    /login failed \(200\)/,
  );
});
