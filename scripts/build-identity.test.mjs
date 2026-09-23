import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readBuildIdentity, sourceHash } from "./build-identity.mjs";

function fixture(t) {
  const prefix = join(tmpdir(), "matool-build-test-");
  const root = mkdtempSync(prefix);
  t.after(() => {
    if (!root.startsWith(prefix)) throw new Error("Unexpected test directory");
    rmSync(root, { recursive: true, force: true });
  });
  for (const folder of ["src", "web", "migrations", "scripts"]) {
    mkdirSync(join(root, folder));
  }
  for (const file of [
    "src/worker.ts", "web/index.html", "migrations/001.sql",
    "package.json", "pnpm-lock.yaml", "wrangler.jsonc", "vite.config.ts",
    "tsconfig.base.json", "tsconfig.worker.json", "tsconfig.web.json",
    "scripts/build-identity.mjs", "scripts/worker-build.mjs"
  ]) {
    writeFileSync(join(root, file), `synthetic ${file}\n`);
  }
  return root;
}

test("source hash is deterministic, includes names and content, excludes secrets", (t) => {
  const root = fixture(t);
  const original = sourceHash(root);
  assert.equal(original, sourceHash(root));
  assert.equal(sourceHash(root, ["src", "web"]), sourceHash(root, ["web", "src"]));
  writeFileSync(join(root, ".dev.vars"), "SYNTHETIC_SECRET=not-a-build-input");
  assert.equal(original, sourceHash(root));
  writeFileSync(join(root, "src/worker.ts"), "changed source");
  assert.notEqual(original, sourceHash(root));
  const changed = sourceHash(root);
  renameSync(join(root, "src/worker.ts"), join(root, "src/renamed.ts"));
  assert.notEqual(changed, sourceHash(root));
});

test("source export without Git never claims a commit", (t) => {
  const identity = readBuildIdentity(fixture(t));
  assert.equal(identity.baseCommit, null);
  assert.equal(identity.workingTree, "unknown");
  assert.match(identity.sourceHash, /^[a-f0-9]{64}$/);
});

test("tracked edits and untracked sources are explicitly dirty", (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  git("init");
  git("add", ".");
  git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
  const clean = readBuildIdentity(root);
  assert.equal(clean.workingTree, "clean");
  assert.equal(clean.baseCommit, git("rev-parse", "HEAD"));
  writeFileSync(join(root, "src/untracked.ts"), "new source");
  const untracked = readBuildIdentity(root);
  assert.equal(untracked.workingTree, "dirty");
  assert.equal(untracked.baseCommit, clean.baseCommit);
  assert.notEqual(untracked.sourceHash, clean.sourceHash);
  writeFileSync(join(root, "src/worker.ts"), "local edits");
  const edited = readBuildIdentity(root);
  assert.equal(edited.workingTree, "dirty");
  assert.equal(edited.baseCommit, clean.baseCommit);
  assert.notEqual(edited.sourceHash, untracked.sourceHash);
});
