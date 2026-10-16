import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import {
  AttackClusteredPositionsResultMessage,
  HumanStatsResultMessage,
  InitErrorMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsErrorMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerBuildablesResultMessage,
  PlayerProfileResultMessage,
  RunTurnsResultMessage,
  SnapshotResultMessage,
  TransportShipSpawnResultMessage,
  WorkerMessage,
} from "@openfront/engine-api/worker/WorkerMessages";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "../GameRunner";

const ctx: Worker = self as any;
// Where answers go: the page that started this worker, or the port it
// handed over (connect).
let out: Pick<MessagePort, "postMessage"> = ctx;
let gameRunner: Promise<GameRunner> | null = null;
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
  let shouldContinue: boolean;
  try {
    const gr = await gameRunner;
    if (!gr) {
      return;
    }

    const batch: GameUpdateViewData[] = [];
    const onTickUpdate = (gu: GameUpdateViewData | ErrorUpdate) => {
      if (!("updates" in gu)) {
        if ("errMsg" in gu) {
          sendMessage({ type: "game_error", error: gu } as WorkerMessage);
        }
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

  out.postMessage(
    {
      type: "game_update_batch",
      gameUpdates,
    } as WorkerMessage,
    transfersOf(gameUpdates),
  );
}

/** The updates' packed buffers, moved to the receiver instead of copied. */
function transfersOf(gameUpdates: GameUpdateViewData[]): Transferable[] {
  const transfers: Transferable[] = [];
  for (const gu of gameUpdates) {
    transfers.push(gu.packedTileUpdates.buffer);
    if (gu.packedMotionPlans) {
      transfers.push(gu.packedMotionPlans.buffer);
    }
    if (gu.packedPlayerUpdates) {
      transfers.push(gu.packedPlayerUpdates.buffer);
    }
    if (gu.packedAttackUpdates) {
      transfers.push(gu.packedAttackUpdates.buffer);
    }
    if (gu.packedNukeImpacts) {
      transfers.push(gu.packedNukeImpacts.buffer);
    }
  }
  return transfers;
}

function sendMessage(message: WorkerMessage) {
  out.postMessage(message);
}

async function onMessage(e: MessageEvent<MainThreadMessage>) {
  const message = e.data;

  switch (message.type) {
    case "connect":
      out = message.port;
      message.port.onmessage = onMessage;
      break;
    case "init":
      try {
        gameRunner = (
          message.snapshot !== undefined
            ? createGameRunnerFromSnapshot(
                message.gameStartInfo,
                message.snapshot,
                message.clientID,
                message.map,
                gameUpdate,
              )
            : createGameRunner(
                message.gameStartInfo,
                message.clientID,
                message.map,
                gameUpdate,
              )
        ).then(
          (gr) => {
            sendMessage({
              type: "initialized",
              id: message.id,
            } as InitializedMessage);
            return gr;
          },
          (error: unknown) => {
            sendMessage({
              type: "init_error",
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            } as InitErrorMessage);
            throw error;
          },
        );
        // The failure is reported above; later messages still see it when
        // they await gameRunner.
        gameRunner.catch(() => {});
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

    case "run_turns": {
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }
      const gr = await gameRunner;
      const gameUpdates: GameUpdateViewData[] = [];
      let error: ErrorUpdate | undefined;
      tickUpdateSink = (gu) => {
        if ("updates" in gu) gameUpdates.push(gu);
        else if ("errMsg" in gu) error = gu;
      };
      try {
        for (const turn of message.turns) gr.addTurn(turn);
        while (gr.pendingTurns() > 0 && gr.executeNextTick()) {
          // Each tick's update arrives through tickUpdateSink.
        }
      } finally {
        tickUpdateSink = null;
      }
      out.postMessage(
        {
          type: "run_turns_result",
          id: message.id,
          gameUpdates,
          error,
        } as RunTurnsResultMessage,
        transfersOf(gameUpdates),
      );
      break;
    }
    case "player_actions":
      if (!gameRunner) {
        sendMessage({
          type: "player_actions_error",
          id: message.id,
          error: "Game runner not initialized",
        } as PlayerActionsErrorMessage);
        break;
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
        sendMessage({
          type: "player_actions_error",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        } as PlayerActionsErrorMessage);
      }
      break;
    case "player_buildables":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const buildables = (await gameRunner).playerBuildables(
          message.playerID,
          message.x,
          message.y,
          message.units,
        );
        sendMessage({
          type: "player_buildables_result",
          id: message.id,
          result: buildables,
        } as PlayerBuildablesResultMessage);
      } catch (error) {
        console.error("Failed to get buildables:", error);
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
    case "human_stats":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        // Messages are handled between drain batches: a tick boundary.
        const result = (await gameRunner).humanStats();
        sendMessage({
          type: "human_stats_result",
          id: message.id,
          result,
        } as HumanStatsResultMessage);
      } catch (error) {
        console.error("Failed to get human stats:", error);
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
    case "attack_clustered_positions":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const attacks = (await gameRunner).attackClusteredPositions(
          message.playerID,
          message.attackID,
        );
        sendMessage({
          type: "attack_clustered_positions_result",
          id: message.id,
          attacks,
        } as AttackClusteredPositionsResultMessage);
      } catch (error) {
        console.error("Failed to get attack front line centers:", error);
        sendMessage({
          type: "attack_clustered_positions_result",
          id: message.id,
          attacks: [],
        } as AttackClusteredPositionsResultMessage);
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
    case "snapshot": {
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }
      let snapshot: Uint8Array | null = null;
      try {
        // Messages are handled between drain batches, so this is always a
        // tick boundary.
        snapshot = (await gameRunner).snapshot(message.gitCommit);
      } catch (error) {
        console.error("Failed to snapshot game:", error);
      }
      out.postMessage(
        {
          type: "snapshot_result",
          id: message.id,
          snapshot,
        } as SnapshotResultMessage,
        snapshot ? [snapshot.buffer] : [],
      );
      break;
    }
    default:
      console.warn("Unknown message :", message);
  }
}

ctx.addEventListener("message", onMessage);

// Error handling
ctx.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

ctx.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in worker:", event);
});
