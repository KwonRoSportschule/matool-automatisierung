import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Only build inputs: never read local credentials, captures or node_modules.
const SOURCE_INPUTS = [
  "src", "web", "migrations", "package.json", "pnpm-lock.yaml",
  "wrangler.jsonc", "vite.config.ts", "tsconfig.base.json",
  "tsconfig.worker.json", "tsconfig.web.json",
  "scripts/build-identity.mjs", "scripts/worker-build.mjs"
];

export function sourceHash(root, inputs = SOURCE_INPUTS) {
  const files = [];
  function visit(relativePath) {
    const absolutePath = join(root, relativePath);
    const info = lstatSync(absolutePath);
    if (info.isDirectory()) {
      for (const name of readdirSync(absolutePath)) {
        visit(`${relativePath}/${name}`);
      }
    } else if (info.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported build input: ${relativePath}`);
    }
  }
  for (const input of inputs) visit(input);
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    const body = readFileSync(join(root, path));
    hash.update(`${path}\0${body.length}\0`);
    hash.update(body);
  }
  return hash.digest("hex");
}

export function readBuildIdentity(root) {
  let baseCommit = null;
  let workingTree = "unknown";
  try {
    const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const head = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], options);
    if (/^[a-f0-9]{40,64}$/.test(head)) {
      baseCommit = head;
      workingTree = status.trim() ? "dirty" : "clean";
    }
  } catch {
    // A source export without Git still has an exact source fingerprint.
  }
  return {
    baseCommit,
    builtAt: new Date().toISOString(),
    sourceHash: sourceHash(root),
    workingTree
  };
}
