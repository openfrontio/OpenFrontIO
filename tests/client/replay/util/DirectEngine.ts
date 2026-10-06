/**
 * A ReplayEngine that runs the game in the test's own thread, so the test
 * can look at the live Game after every tick. The browser runs the engine's
 * worker instead (WorkerReplayEngine).
 */

import { MapFiles } from "@openfront/engine-api/game/GameMapLoader";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import { mapFilesLoader } from "@openfront/engine-lib/game/MapFiles";
import { Game } from "@openfront/engine/game/Game";
import { createGameRunner } from "@openfront/engine/GameRunner";
import type { ReplayEngine } from "../../../../src/client/replay/processor/ReplayProcessor";

export function directEngine(
  onTick?: (game: Game, gu: GameUpdateViewData) => void,
): (gameStart: GameStartInfo, map: MapFiles) => Promise<ReplayEngine> {
  return async (gameStart, map) => {
    let gameUpdates: GameUpdateViewData[] = [];
    let error: ErrorUpdate | undefined;
    // The callback only runs from executeNextTick, once `runner` is set.
    const runner = await createGameRunner(
      gameStart,
      undefined,
      mapFilesLoader(map),
      (gu) => {
        if ("errMsg" in gu) {
          error = gu;
          return;
        }
        gameUpdates.push(gu);
        onTick?.(runner.game, gu);
      },
    );
    return {
      async run(turns) {
        gameUpdates = [];
        error = undefined;
        for (const turn of turns) runner.addTurn(turn);
        while (runner.pendingTurns() > 0 && runner.executeNextTick()) {
          // Each tick's update arrives through the callback.
        }
        return { gameUpdates, error };
      },
      close() {},
    };
  };
}
