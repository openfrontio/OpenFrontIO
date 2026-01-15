import { logger } from "./Logger";

const log = logger.child({ comp: "polling" });

/**
 * Starts a polling loop that executes the given async task effectively recursively using setTimeout.
 * This guarantees that the next execution only starts after the previous one has completed (or failed),
 * preventing request pile-ups.
 *
 * @param task The async function to execute.
 * @param intervalMs The delay in milliseconds before the next execution.
 */
export function startPolling(task: () => Promise<void>, intervalMs: number) {
  const runLoop = () => {
    task()
      .catch((error) => {
        log.error("Error in polling loop:", error);
      })
      .finally(() => {
        setTimeout(runLoop, intervalMs);
      });
  };
  runLoop();
}
