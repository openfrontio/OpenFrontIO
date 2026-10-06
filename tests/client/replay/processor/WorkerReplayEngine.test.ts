// @vitest-environment node
/**
 * The replay processor on the engine's own worker entry (Worker.worker.ts),
 * connected and talking to it the way the browser does (LocalProcessing).
 * The replay has to come out the same as with the engine in the test's
 * thread.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { loadMapFiles } from "@openfront/engine-lib/game/MapFiles";
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

// The engine loads nothing: the map comes in its init message.
const fetch = vi.fn(() => Promise.reject(new Error("the engine fetched")));
// After connect the worker answers on the port, never on `self`.
const self = Object.assign(new EventTarget(), { postMessage: vi.fn() });

beforeAll(async () => {
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("self", self);
  await import("@openfront/engine/worker/Worker.worker");
});

/** Connects the worker to a new channel, as LocalProcessing does. */
function connect(): MessagePort {
  const channel = new MessageChannel();
  new PageEnd(self).postMessage({ type: "connect", port: channel.port1 }, [
    channel.port1,
  ]);
  return channel.port2;
}

test("processing on the engine worker makes the same replay", async () => {
  const port = connect();
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
    startWorkerEngine(port, gameStart, map),
  );
  expect(viaWorker.result.totalTicks).toBe(230);
  expect(viaWorker.replay).toEqual(direct.replay);
  expect(self.postMessage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}, 60_000);

test("a game the engine can't start fails with the engine's reason", async () => {
  const onion = await loadMapFiles(
    mapLoader,
    GameMapType.Onion,
    GameMapSize.Normal,
  );
  const gameStart = {
    gameID: "procWRKR2",
    lobbyCreatedAt: 1_700_000_000_000,
    config: config({ gameMap: GameMapType.Pangaea }),
    players: [human(1)],
  };
  // Answered at once, not after the init timeout.
  await expect(startWorkerEngine(connect(), gameStart, onion)).rejects.toThrow(
    /couldn't start the game: only .* was passed/,
  );
}, 10_000);
