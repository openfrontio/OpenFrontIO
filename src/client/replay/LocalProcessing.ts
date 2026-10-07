/**
 * Runs the replay processor in a worker (ReplayProcessor.worker) and passes
 * the replay to the viewer as it grows: first the header fields that don't
 * change, then the new frames as they're processed.
 *
 * The engine runs in its own worker, the one live games use. This side
 * starts it and gives the two workers a channel to talk on directly.
 */

import type { Difficulty } from "@openfront/engine-api/game/GameTypes";
import type { ConnectMessage } from "@openfront/engine-api/worker/WorkerMessages";
import { getCdnBase } from "@openfront/shared/AssetUrls";
import type { GameRecord, WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { createGameWorker } from "../WorkerClient";
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
  createEngine: () => Promise<Worker> = createGameWorker,
): Processing {
  let workers: Worker[] = [];
  let cancelled = false;
  const stop = () => {
    cancelled = true;
    for (const w of workers) w.terminate();
    workers = [];
  };
  const fail = (message: string) => {
    if (cancelled) return;
    stop();
    handlers.onError(message, false);
  };
  const start = async (create: () => Promise<Worker>) => {
    const w = await create();
    if (cancelled) w.terminate();
    else workers.push(w);
    return w;
  };

  Promise.all([start(createWorker), start(createEngine)]).then(
    ([w, engine]) => {
      if (cancelled) return;
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
      w.addEventListener("error", (e) =>
        fail(e.message || "the replay worker failed"),
      );
      engine.addEventListener("error", (e) =>
        fail(e.message || "the engine worker failed"),
      );
      const channel = new MessageChannel();
      const connect: ConnectMessage = { type: "connect", port: channel.port1 };
      engine.postMessage(connect, [channel.port1]);
      const request: ProcessorRequest = {
        record,
        cdnBase: getCdnBase(),
        engine: channel.port2,
      };
      w.postMessage(request, [channel.port2]);
    },
    (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
  );

  return { cancel: stop };
}

export async function extractSnapshotInWorker(
  record: GameRecord,
  targetTick: number,
  chosenPlayerID: string,
  localClientID: string,
  difficulty?: Difficulty,
  createWorker: () => Promise<Worker> = createProcessorWorker,
  signal?: AbortSignal,
): Promise<{
  snapshot: Uint8Array;
  gameStartInfo: WireGameStartInfo;
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
