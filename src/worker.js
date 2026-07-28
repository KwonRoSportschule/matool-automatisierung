import { isOperatingTime } from "./schedule.js";
import { login } from "./session.js";

export function createWorker({ loginImpl = login } = {}) {
  return {
    async scheduled(controller, env) {
      // This gate intentionally precedes every external operation, including KV.
      if (!isOperatingTime(new Date(controller.scheduledTime))) return;

      const matoolFetch = await loginImpl({
        mail: env.MATOOL_MAIL,
        password: env.MATOOL_PASS,
      });

      // Collectors are enabled only after their real request sequence and parser
      // have been verified. Keeping the authenticated fetch local guarantees one
      // shared login/session per synchronization run.
      await runCollectors([], { matoolFetch, env });
    },
  };
}

export async function runCollectors(collectors, context) {
  const results = [];
  for (const collector of collectors) results.push(await collector.collect(context));
  return results;
}

export default createWorker();
