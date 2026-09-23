/**
 * Worker that turns a game record into a replay with this build's core
 * (processGameRecord in src/client/replay/processor). See LocalProcessing.ts.
 */

import { assetUrl } from "../../core/AssetUrls";
import { FetchGameMapLoader } from "../../core/game/FetchGameMapLoader";
import { gzipInBrowser } from "./BrowserGzip";
import {
  processGameRecord,
  ReplayDesyncError,
} from "./processor/ReplayProcessor";
import type { ProcessorRequest, ProcessorResponse } from "./ProcessorMessages";

const ctx = self as unknown as Worker;
globalThis.__ASSET_MANIFEST__ = __ASSET_MANIFEST__;
const mapLoader = new FetchGameMapLoader((path) => assetUrl(`maps/${path}`));

function send(msg: ProcessorResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.addEventListener("message", (e: MessageEvent<ProcessorRequest>) => {
  const { record, cdnBase } = e.data;
  // Workers have no `window`, so AssetUrls reads the CDN base from here
  // (same as Worker.worker.ts).
  globalThis.__CDN_BASE__ = cdnBase;
  processGameRecord(record, {
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
