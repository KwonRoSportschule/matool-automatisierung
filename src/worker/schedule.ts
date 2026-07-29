import type { Env } from "./env";
import { getProcessMode } from "./repository";

export async function handleScheduledInvocation(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  const mode = await getProcessMode(env);

  if (mode === "disabled") {
    console.info(
      JSON.stringify({
        event: "scheduled_run_skipped",
        reason: "process_disabled",
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    return;
  }

  if (env.MATOOL_REAL_RUNS_ENABLED !== "confirmed-read-only") {
    console.info(
      JSON.stringify({
        event: "scheduled_run_skipped",
        reason: "real_matool_runs_not_confirmed",
        scheduledTime: new Date(controller.scheduledTime).toISOString()
      })
    );
    return;
  }

  console.info(
    JSON.stringify({
      event: "scheduled_run_skipped",
      reason: "collector_source_mapping_not_verified",
      scheduledTime: new Date(controller.scheduledTime).toISOString()
    })
  );
}
