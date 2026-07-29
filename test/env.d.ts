import type { Env as WorkerEnv } from "../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends WorkerEnv {
    TEST_MIGRATIONS: D1Migration[];
  }
}
