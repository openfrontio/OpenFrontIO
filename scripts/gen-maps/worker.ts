// Worker thread: generates the maps the main thread hands it, one at a time.
import { parentPort, workerData } from "node:worker_threads";
import { Logger, type LogFlags } from "./logger";
import { processMap } from "./processMap";

const { level, flags } = workerData as { level: number; flags: LogFlags };
const base = new Logger(level, flags);

parentPort!.on("message", (task: { name: string; isTest: boolean } | null) => {
  if (task === null) {
    parentPort!.close();
    return;
  }
  const t0 = performance.now();
  try {
    const manifestPath = processMap(
      base.withMap(task.name, task.isTest),
      task.name,
      task.isTest,
    );
    parentPort!.postMessage({
      name: task.name,
      manifestPath,
      ms: performance.now() - t0,
    });
  } catch (e) {
    parentPort!.postMessage({
      name: task.name,
      error: (e as Error).message,
      ms: performance.now() - t0,
    });
  }
});
