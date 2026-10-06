import { GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import type { ReplayedWinner } from "@openfront/engine/WinnerReplay";
import { fork } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./Logger";

// When clients disagree on a game's winner, the server replays the game
// itself (see GameServer.settleWinner). A replay is a whole game's worth of
// simulation, so it runs in a subprocess at the lowest CPU priority, where it
// can only use time the live games' turn loops leave over. Nothing waits on
// it but the game record, so it may take as long as it needs, up to a limit.

const log = logger.child({ component: "WinnerReplay" });

const CHILD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "WinnerReplayChild.ts",
);

// A 3-hour game on the biggest map, starved of CPU, finishes well inside
// this; past it the replay is presumed stuck.
const TIMEOUT_MS = 30 * 60 * 1000;
// Caps the child's heap so a runaway replay dies on its own instead of
// taking the worker's memory with it.
const MAX_HEAP_MB = 2048;

export interface ReplayRequest {
  gameStart: GameStartInfo;
  turns: Turn[];
}

export type ReplayResponse =
  | { ok: true; result: ReplayedWinner }
  | { ok: false; error: string };

// Replays a game and resolves with the simulation's result, or null if the
// replay failed (crashed, threw, or timed out).
export type WinnerReplayer = (
  gameStart: GameStartInfo,
  turns: Turn[],
) => Promise<ReplayedWinner | null>;

// One replay at a time per worker; the rest wait their turn.
let queue: Promise<unknown> = Promise.resolve();

export const replayWinnerInChild: WinnerReplayer = (gameStart, turns) => {
  const run = queue.then(() => runChild(gameStart, turns));
  queue = run;
  return run;
};

function runChild(
  gameStart: GameStartInfo,
  turns: Turn[],
): Promise<ReplayedWinner | null> {
  const gameID = gameStart.gameID;
  const start = Date.now();
  return new Promise((resolve) => {
    let response: ReplayResponse | null = null;
    const child = fork(CHILD, [], {
      // Structured clone: the stats carry bigints, which JSON cannot.
      serialization: "advanced",
      // Inherits the tsx loader the server runs under.
      execArgv: [...process.execArgv, `--max-old-space-size=${MAX_HEAP_MB}`],
    });
    if (child.pid !== undefined) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
      } catch (error) {
        log.warn(`could not lower replay priority: ${error}`, { gameID });
      }
    }
    const timer = setTimeout(() => {
      log.error("winner replay timed out", { gameID, timeoutMs: TIMEOUT_MS });
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("message", (msg: ReplayResponse) => {
      response = msg;
    });
    child.on("error", (error) => {
      log.error(`winner replay process error: ${error}`, { gameID });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const res = response as ReplayResponse | null;
      if (res?.ok) {
        log.info("winner replay finished", {
          gameID,
          durationMs: Date.now() - start,
          tick: res.result.tick,
        });
        resolve(res.result);
        return;
      }
      log.error("winner replay failed", {
        gameID,
        error: res?.error,
        code,
        signal,
      });
      resolve(null);
    });
    child.send({ gameStart, turns } satisfies ReplayRequest);
  });
}
