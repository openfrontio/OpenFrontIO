// @vitest-environment node
/**
 * The replay processor on the engine's own worker entry (Worker.worker.ts),
 * connected and talking to it the way the browser does (LocalProcessing).
 * The replay has to come out the same as with the engine in the test's
 * thread.
 */

import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import type {
  ReplayAppend,
  ReplayBase,
} from "../../../../src/client/replay/codec/ReplayTypes";
import { processGameRecord } from "../../../../src/client/replay/processor/ReplayProcessor";
import { startWorkerEngine } from "../../../../src/client/replay/processor/WorkerReplayEngine";
import {
  config,
  human,
  mapLoader,
  playAndArchive,
  spawnOnLand,
} from "../util/ArchiveGame";
import { directEngine } from "../util/DirectEngine";
import { gzip, mergeAppends } from "../util/RecordGame";

/** The page's side of the engine worker: what it posts arrives at `self`. */
class PageEnd {
  constructor(private readonly self: EventTarget) {}
  postMessage(data: unknown, transfer: Transferable[] = []) {
    const copy = structuredClone(data, { transfer });
    setTimeout(() =>
      this.self.dispatchEvent(new MessageEvent("message", { data: copy })),
    );
  }
}

async function process(
  record: Parameters<typeof processGameRecord>[0],
  engine: Parameters<typeof processGameRecord>[1]["engine"],
) {
  let base!: ReplayBase;
  const appends: ReplayAppend[] = [];
  const result = await processGameRecord(record, {
    engine,
    mapLoader,
    gzip,
    keyframeInterval: 20,
    onStart: (b) => (base = b),
    onAppend: (a) => void appends.push(a),
  });
  return { result, replay: { base, append: mergeAppends(appends) } };
}

test("processing on the engine worker makes the same replay", async () => {
  // The engine loads nothing: the map comes in its init message.
  const fetch = vi.fn(() => Promise.reject(new Error("the engine fetched")));
  vi.stubGlobal("fetch", fetch);
  // After connect the worker answers on the port, never on `self`.
  const self = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  vi.stubGlobal("self", self);
  await import("@openfront/engine/worker/Worker.worker");
  const channel = new MessageChannel();
  new PageEnd(self).postMessage({ type: "connect", port: channel.port1 }, [
    channel.port1,
  ]);

  const { record } = await playAndArchive({
    gameID: "procWRKR1",
    config: config({ gameMap: GameMapType.Onion, bots: 5 }),
    players: [human(1)],
    // More turns than one run_turns message takes.
    ticks: 230,
    intents: (game, t) =>
      t === 3 ? [spawnOnLand(game, "client001", 1000)] : [],
  });

  const direct = await process(record, directEngine());
  const viaWorker = await process(record, (gameStart, map) =>
    startWorkerEngine(channel.port2, gameStart, map),
  );
  expect(viaWorker.result.totalTicks).toBe(230);
  expect(viaWorker.replay).toEqual(direct.replay);
  expect(self.postMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}, 60_000);
