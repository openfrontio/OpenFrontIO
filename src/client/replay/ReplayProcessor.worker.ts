/**
 * Worker that turns a game record into a replay with this build's engine
 * (processGameRecord in src/client/replay/processor). The engine runs in a
 * worker of its own, which the page starts and hands over a port to. See
 * LocalProcessing.ts.
 */

import { assetUrl } from "@openfront/shared/AssetUrls";
import { FetchGameMapLoader } from "@openfront/shared/FetchGameMapLoader";
import { gzipInBrowser } from "./BrowserGzip";
import {
  processGameRecord,
  ReplayDesyncError,
} from "./processor/ReplayProcessor";
import { startWorkerEngine } from "./processor/WorkerReplayEngine";
import type { ProcessorRequest, ProcessorResponse } from "./ProcessorMessages";

const ctx = self as unknown as Worker;
globalThis.__ASSET_MANIFEST__ = __ASSET_MANIFEST__;
const mapLoader = new FetchGameMapLoader((path) => assetUrl(`maps/${path}`));

function send(msg: ProcessorResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.addEventListener("message", (e: MessageEvent<ProcessorRequest>) => {
  const req = e.data;
  // Workers have no `window`, so AssetUrls reads the CDN base from here
  // (same as Worker.worker.ts).
  globalThis.__CDN_BASE__ = req.cdnBase;

  processGameRecord(req.record, {
    engine: (gameStart, map) => startWorkerEngine(req.engine, gameStart, map),
    mapLoader,
    gzip: gzipInBrowser,
    onProgress: (p) => send({ type: "progress", percent: p.percent }),
    onStart: (base) => send({ type: "start", base }),
    onAppend: (append) => {
      // The worker never asks for the whole file, so the encoder doesn't
      // need its chunks after this and they can be moved, not copied.
      send(
        { type: "append", append },
        append.chunks.map((c) => c.compressed.buffer),
      );
    },
  }).then(
    () => send({ type: "done" }),
    (err: unknown) => {
      send({
        type: "error",
        desync: err instanceof ReplayDesyncError,
        message: err instanceof Error ? err.message : String(err),
      });
    },
  );
});
