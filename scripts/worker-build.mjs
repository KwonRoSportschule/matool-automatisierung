import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readBuildIdentity } from "./build-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(relativeScript, args) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(relativeScript, import.meta.url)), ...args], {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build the served assets too, so their source cannot silently be newer than
// the website included in this Worker build. No generated metadata file to
// accidentally reuse or commit; the identity is embedded in this bundle.
run("../node_modules/vite/bin/vite.js", ["build"]);
const identity = readBuildIdentity(root);
console.log(`Build source ${identity.sourceHash} (${identity.workingTree})`);
run("../node_modules/wrangler/bin/wrangler.js", [
  "deploy",
  ...process.argv.slice(2),
  "--define",
  `__MATOOL_BUILD_INFO__:${JSON.stringify(identity)}`
]);
