import version from "resources/version.txt?raw";
import { createGameRunner, GameRunner } from "../GameRunner";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import {
  AttackAveragePositionResultMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerProfileResultMessage,
  TransportShipSpawnResultMessage,
  WorkerMessage,
} from "./WorkerMessages";

const ctx: Worker = self as any;
let gameRunner: Promise<GameRunner> | null = null;
const mapLoader = new FetchGameMapLoader(`/maps`, version);
// Yield threshold; not a backlog cap. Used to avoid monopolizing the worker task
// and flooding the main thread with messages during catch-up.
const MAX_TICKS_BEFORE_YIELD = 4;

let drainScheduled = false;
let draining = false;
let drainRequested = false;

function scheduleDrain(): void {
  drainRequested = true;
  if (drainScheduled || draining) {
    return;
  }
  drainScheduled = true;
  setTimeout(() => {
    void drain().catch((e) => {
      console.error("Worker drain failed:", e);
    });
  }, 0);
}

async function drain(): Promise<void> {
  drainScheduled = false;
  if (draining) {
    return;
  }
  if (!gameRunner) {
    return;
  }

  draining = true;
  drainRequested = false;
  let shouldContinue = false;
  try {
    const gr = await gameRunner;
    if (!gr) {
      return;
    }

    const batch: GameUpdateViewData[] = [];
    const onTickUpdate = (gu: GameUpdateViewData | ErrorUpdate) => {
      if (!("updates" in gu)) {
        return;
      }
      batch.push(gu);
    };

    // Temporarily route tick callbacks into this drain's batch.
    tickUpdateSink = onTickUpdate;

    let ticksRun = 0;
    while (ticksRun < MAX_TICKS_BEFORE_YIELD && gr.pendingTurns() > 0) {
      const ok = gr.executeNextTick(gr.pendingTurns());
      if (!ok) {
        break;
      }
      ticksRun++;
    }

    tickUpdateSink = null;

    sendGameUpdateBatch(batch);

    shouldContinue = gr.pendingTurns() > 0;
  } finally {
    tickUpdateSink = null;
    draining = false;
  }

  if (shouldContinue || drainRequested) {
    scheduleDrain();
  }
}

let tickUpdateSink: ((gu: GameUpdateViewData | ErrorUpdate) => void) | null =
  null;

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  tickUpdateSink?.(gu);
}

function sendGameUpdateBatch(gameUpdates: GameUpdateViewData[]): void {
  if (gameUpdates.length === 0) {
    return;
  }

  const transfers: Transferable[] = [];
  for (const gu of gameUpdates) {
    transfers.push(gu.packedTileUpdates.buffer);
    if (gu.packedMotionPlans) {
      transfers.push(gu.packedMotionPlans.buffer);
    }
  }

  ctx.postMessage(
    {
      type: "game_update_batch",
      gameUpdates,
    } as WorkerMessage,
    transfers,
  );
}

function sendMessage(message: WorkerMessage) {
  ctx.postMessage(message);
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "init":
      try {
        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          mapLoader,
          gameUpdate,
        ).then((gr) => {
          sendMessage({
            type: "initialized",
            id: message.id,
          } as InitializedMessage);
          return gr;
        });
      } catch (error) {
        console.error("Failed to initialize game runner:", error);
        throw error;
      }
      break;

    case "turn":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const gr = await gameRunner;
        gr.addTurn(message.turn);
        scheduleDrain();
      } catch (error) {
        console.error("Failed to process turn:", error);
        throw error;
      }
      break;

    case "player_actions":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const actions = (await gameRunner).playerActions(
          message.playerID,
          message.x,
          message.y,
          message.units,
        );
        sendMessage({
          type: "player_actions_result",
          id: message.id,
          result: actions,
        } as PlayerActionsResultMessage);
      } catch (error) {
        console.error("Failed to get actions:", error);
        throw error;
      }
      break;
    case "player_profile":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const profile = (await gameRunner).playerProfile(message.playerID);
        sendMessage({
          type: "player_profile_result",
          id: message.id,
          result: profile,
        } as PlayerProfileResultMessage);
      } catch (error) {
        console.error("Failed to get profile:", error);
        throw error;
      }
      break;
    case "player_border_tiles":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const borderTiles = (await gameRunner).playerBorderTiles(
          message.playerID,
        );
        sendMessage({
          type: "player_border_tiles_result",
          id: message.id,
          result: borderTiles,
        } as PlayerBorderTilesResultMessage);
      } catch (error) {
        console.error("Failed to get border tiles:", error);
        throw error;
      }
      break;
    case "attack_average_position":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const averagePosition = (await gameRunner).attackAveragePosition(
          message.playerID,
          message.attackID,
        );
        sendMessage({
          type: "attack_average_position_result",
          id: message.id,
          x: averagePosition ? averagePosition.x : null,
          y: averagePosition ? averagePosition.y : null,
        } as AttackAveragePositionResultMessage);
      } catch (error) {
        console.error("Failed to get attack average position:", error);
        throw error;
      }
      break;
    case "transport_ship_spawn":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const spawnTile = (await gameRunner).bestTransportShipSpawn(
          message.playerID,
          message.targetTile,
        );
        sendMessage({
          type: "transport_ship_spawn_result",
          id: message.id,
          result: spawnTile,
        } as TransportShipSpawnResultMessage);
      } catch (error) {
        console.error("Failed to spawn transport ship:", error);
      }
      break;
    default:
      console.warn("Unknown message :", message);
  }
});

// Error handling
ctx.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

ctx.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in worker:", event);
});
