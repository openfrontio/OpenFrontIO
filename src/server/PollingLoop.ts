import { logger } from "./Logger";

const log = logger.child({ comp: "polling" });

/**
 * Handle returned by {@link startPolling}. Calling {@link PollingHandle.stop}
 * cancels any pending scheduled execution and prevents an in-flight task from
 * scheduling the next one, letting the loop halt cleanly (e.g. on component
 * teardown or server shutdown).
 */
export interface PollingHandle {
  /** Stops the polling loop. Idempotent; safe to call multiple times. */
  stop: () => void;
}

/**
 * Starts a polling loop that executes the given async task effectively recursively using setTimeout.
 * This guarantees that the next execution only starts after the previous one has completed (or failed),
 * preventing request pile-ups.
 *
 * @param task The async function to execute.
 * @param intervalMs The delay in milliseconds before the next execution.
 * @returns A {@link PollingHandle} whose `stop` method cancels the loop.
 */
export function startPolling(
  task: () => Promise<void>,
  intervalMs: number,
): PollingHandle {
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const runLoop = () => {
    task()
      .catch((error) => {
        log.error("Error in polling loop:", error);
      })
      .finally(() => {
        // Don't schedule another run if stop() was called, including while
        // this task was in flight.
        if (stopped) return;
        timeout = setTimeout(runLoop, intervalMs);
      });
  };

  runLoop();

  return {
    stop: () => {
      stopped = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    },
  };
}
