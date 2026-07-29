import type { Env } from "./env";
import { processZapierOutbox } from "./outbox";
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

  if (
    mode === "active" &&
    env.OUTBOUND_DELIVERY_ENABLED === "true"
  ) {
    try {
      const outbox = await processZapierOutbox(env);
      console.info(
        JSON.stringify({
          event: "zapier_outbox_processed",
          accepted: outbox.accepted,
          awaitingClaims: outbox.awaitingClaims,
          permanentFailures: outbox.permanentFailures,
          processed: outbox.processed,
          retriesScheduled: outbox.retriesScheduled,
          scheduledTime: new Date(controller.scheduledTime).toISOString()
        })
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "zapier_outbox_failed",
          errorCode: "zapier_outbox_processing_failed",
          scheduledTime: new Date(controller.scheduledTime).toISOString()
        })
      );
    }
  }

  console.info(
    JSON.stringify({
      event: "collector_run_skipped",
      reason: "collector_source_mapping_not_verified",
      scheduledTime: new Date(controller.scheduledTime).toISOString()
    })
  );
}
