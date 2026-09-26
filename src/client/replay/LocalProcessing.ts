/**
 * Runs the replay processor in a worker (ReplayProcessor.worker) and passes
 * the replay to the viewer as it grows: first the header fields that don't
 * change, then the new frames as they're processed.
 */

import { getCdnBase } from "../../core/AssetUrls";
import type { GameRecord } from "../../core/Schemas";
import type { ReplayAppend, ReplayBase } from "./codec/ReplayTypes";
import type { ProcessorRequest, ProcessorResponse } from "./ProcessorMessages";

export interface ProcessingHandlers {
  onProgress(percent: number): void;
  /** The header fields that don't change, before any frames. */
  onStart(base: ReplayBase): void;
  /**
   * The frames processed since the previous call. The first comes after
   * about a second.
   */
  onAppend(append: ReplayAppend): void;
  /** Processing finished, after the last append. */
  onDone(): void;
  /** `desync`: the record doesn't replay on this build. */
  onError(message: string, desync: boolean): void;
}

export interface Processing {
  /** Stops the worker. No handlers are called after this. */
  cancel(): void;
}

// Inlined as a same-origin Blob like the game worker (WorkerClient.ts),
// because the bundle is served from the CDN and a cross-origin
// `new Worker(url)` gets refused. The dynamic import keeps it out of the
// main bundle.
async function createProcessorWorker(): Promise<Worker> {
  const { default: ProcessorWorker } =
    await import("./ReplayProcessor.worker.ts?worker&inline");
  return new ProcessorWorker();
}

export function processInBrowser(
  record: GameRecord,
  handlers: ProcessingHandlers,
  createWorker: () => Promise<Worker> = createProcessorWorker,
): Processing {
  let worker: Worker | null = null;
  let cancelled = false;
  const stop = () => {
    cancelled = true;
    worker?.terminate();
    worker = null;
  };

  createWorker().then(
    (w) => {
      if (cancelled) {
        w.terminate();
        return;
      }
      worker = w;
      w.addEventListener("message", (e: MessageEvent<ProcessorResponse>) => {
        if (cancelled) return;
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            handlers.onProgress(msg.percent);
            break;
          case "start":
            handlers.onStart(msg.base);
            break;
          case "append":
            handlers.onAppend(msg.append);
            break;
          case "done":
            stop();
            handlers.onDone();
            break;
          case "error":
            stop();
            handlers.onError(msg.message, msg.desync);
            break;
        }
      });
      w.addEventListener("error", (e) => {
        if (cancelled) return;
        stop();
        handlers.onError(e.message || "the replay worker failed", false);
      });
      const request: ProcessorRequest = { record, cdnBase: getCdnBase() };
      w.postMessage(request);
    },
    (err: unknown) => {
      if (cancelled) return;
      stop();
      handlers.onError(err instanceof Error ? err.message : String(err), false);
    },
  );

  return { cancel: stop };
}

export async function extractSnapshotInWorker(
  record: GameRecord,
  targetTick: number,
  chosenPlayerID: string,
  localClientID: string,
  difficulty?: import("../../core/game/Game").Difficulty,
  createWorker: () => Promise<Worker> = createProcessorWorker,
  signal?: AbortSignal,
): Promise<{
  snapshot: Uint8Array;
  gameStartInfo: import("../../core/Schemas").GameStartInfo;
}> {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }
  const worker = await createWorker();
  if (signal?.aborted) {
    worker.terminate();
    throw (
      signal.reason ??
      new DOMException("The operation was aborted.", "AbortError")
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      worker.terminate();
      reject(
        signal?.reason ??
          new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    worker.addEventListener("message", (e: MessageEvent<ProcessorResponse>) => {
      const msg = e.data;
      if (msg.type === "snapshot_extracted") {
        cleanup();
        worker.terminate();
        resolve({ snapshot: msg.snapshot, gameStartInfo: msg.gameStartInfo });
      } else if (msg.type === "error") {
        cleanup();
        worker.terminate();
        reject(new Error(msg.message));
      }
    });
    worker.addEventListener("error", (e) => {
      cleanup();
      worker.terminate();
      reject(new Error(e.message || "the replay worker failed"));
    });
    const request: ProcessorRequest = {
      type: "extract_snapshot",
      record,
      targetTick,
      chosenPlayerID,
      localClientID,
      difficulty,
      cdnBase: getCdnBase(),
    };
    worker.postMessage(request);
  });
}
