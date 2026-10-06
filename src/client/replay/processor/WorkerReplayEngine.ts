/**
 * A ReplayEngine on the engine's worker (Worker.worker.ts), the same entry
 * live games run on. The page starts the worker and hands this side a port
 * to it (connect, see LocalProcessing.ts). The game is started with `init`
 * and the turns go through `run_turns`, which runs them without waiting
 * between ticks.
 */

import type { MapFiles } from "@openfront/engine-api/game/GameMapLoader";
import type { GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import type {
  MainThreadMessage,
  RunTurnsResultMessage,
  WorkerMessage,
} from "@openfront/engine-api/worker/WorkerMessages";
import { mapFilesTransfer } from "@openfront/engine-lib/game/MapFiles";
import type { ReplayEngine } from "./ReplayProcessor";

/** How long the engine gets to build the map and start the game. */
const INIT_TIMEOUT_MS = 60_000;

/** Starts the game on the engine. The map files are moved, not copied. */
export function startWorkerEngine(
  port: MessagePort,
  gameStart: GameStartInfo,
  map: MapFiles,
): Promise<ReplayEngine> {
  let nextId = 0;
  const pending = new Map<
    string,
    { resolve: (msg: WorkerMessage) => void; reject: (err: Error) => void }
  >();
  let failure: Error | null = null;
  const fail = (err: Error) => {
    failure ??= err;
    for (const p of pending.values()) p.reject(failure);
    pending.clear();
  };
  port.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const id = e.data.id;
    if (id === undefined) return;
    pending.get(id)?.resolve(e.data);
    pending.delete(id);
  };
  const request = (
    msg: MainThreadMessage,
    transfer: Transferable[] = [],
  ): Promise<WorkerMessage> => {
    if (failure !== null) return Promise.reject(failure);
    const id = String(nextId++);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ ...msg, id }, transfer);
    });
  };

  const engine: ReplayEngine = {
    async run(turns: Turn[]) {
      const msg = (await request({
        type: "run_turns",
        turns,
      })) as RunTurnsResultMessage;
      return { gameUpdates: msg.gameUpdates, error: msg.error };
    },
    close() {
      fail(new Error("the engine was closed"));
      port.close();
    },
  };

  const timeout = setTimeout(
    () => fail(new Error("the engine worker didn't start the game in time")),
    INIT_TIMEOUT_MS,
  );
  return request(
    { type: "init", gameStartInfo: gameStart, clientID: undefined, map },
    mapFilesTransfer(map),
  ).then(
    () => {
      clearTimeout(timeout);
      return engine;
    },
    (err: Error) => {
      clearTimeout(timeout);
      port.close();
      throw err;
    },
  );
}
