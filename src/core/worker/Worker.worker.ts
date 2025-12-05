import version from "../../../resources/version.txt";
import { createGameRunner, GameRunner } from "../GameRunner";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import {
  createSharedTileRingViews,
  pushTileUpdate,
  SharedTileRingViews,
} from "./SharedTileRing";
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
let isProcessingTurns = false;
let sharedTileRing: SharedTileRingViews | null = null;
let dirtyFlags: Uint8Array | null = null;
let sharedDrawPhase: Uint32Array | null = null;
let lastOwner: Uint16Array | null = null;
let timeBaseMs = Date.now();
let tickNowOffset = 0;
let nextCaptureOffset = 0;
const STAGGER_MS = 2;
let gameRef: Game | null = null;

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }
  sendMessage({
    type: "game_update",
    gameUpdate: gu,
  });
}

function sendMessage(message: WorkerMessage) {
  ctx.postMessage(message);
}

async function processPendingTurns() {
  if (isProcessingTurns) {
    return;
  }
  if (!gameRunner) {
    return;
  }

  const gr = await gameRunner;
  if (!gr || !gr.hasPendingTurns()) {
    return;
  }

  isProcessingTurns = true;
  try {
    while (gr.hasPendingTurns()) {
      tickNowOffset = Math.max(0, Date.now() - timeBaseMs);
      nextCaptureOffset = 0;
      gr.executeNextTick();
    }
  } finally {
    isProcessingTurns = false;
  }
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "init":
      try {
        if (
          message.sharedTileRingHeader &&
          message.sharedTileRingData &&
          message.sharedDirtyBuffer &&
          message.sharedDrawPhaseBuffer
        ) {
          sharedTileRing = createSharedTileRingViews({
            header: message.sharedTileRingHeader,
            data: message.sharedTileRingData,
            dirty: message.sharedDirtyBuffer,
            drawPhase: message.sharedDrawPhaseBuffer,
          });
          dirtyFlags = sharedTileRing.dirtyFlags;
          sharedDrawPhase = sharedTileRing.drawPhase;
        } else {
          sharedTileRing = null;
          dirtyFlags = null;
          sharedDrawPhase = null;
        }
        timeBaseMs = message.timeBaseMs ?? Date.now();

        const tileUpdateSink =
          sharedTileRing || sharedDrawPhase
            ? (tile: TileRef) => {
                if (sharedTileRing && dirtyFlags) {
                  if (Atomics.compareExchange(dirtyFlags, tile, 0, 1) === 0) {
                    pushTileUpdate(sharedTileRing, tile);
                  }
                } else if (sharedTileRing) {
                  pushTileUpdate(sharedTileRing, tile);
                }

                if (!sharedDrawPhase || !gameRef || !lastOwner) {
                  return;
                }

                const newOwner = gameRef.ownerID(tile);
                const prevOwner = lastOwner[tile];
                const ownerChanged = newOwner !== prevOwner;
                lastOwner[tile] = newOwner;

                const nowOffset = tickNowOffset;
                let reveal = nowOffset;
                if (ownerChanged) {
                  const offset = nowOffset - nextCaptureOffset * STAGGER_MS;
                  reveal = offset <= 0 ? 0 : offset >>> 0;
                  nextCaptureOffset++;
                }
                sharedDrawPhase[tile] = reveal >>> 0;
              }
            : undefined;

        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          mapLoader,
          gameUpdate,
          tileUpdateSink,
          message.sharedStateBuffer,
        ).then((gr) => {
          gameRef = gr.game;
          const map = gameRef.map();
          const numTiles = map.width() * map.height();
          lastOwner = new Uint16Array(numTiles);
          map.forEachTile((tile) => {
            lastOwner![tile] = map.ownerID(tile);
          });
          tickNowOffset = Math.max(0, Date.now() - timeBaseMs);
          if (sharedDrawPhase) {
            sharedDrawPhase.fill(tickNowOffset >>> 0);
          }
          sendMessage({
            type: "initialized",
            id: message.id,
          } as InitializedMessage);
          processPendingTurns();
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
        await gr.addTurn(message.turn);
        processPendingTurns();
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
        );
        sendMessage({
          type: "player_actions_result",
          id: message.id,
          result: actions,
        } as PlayerActionsResultMessage);
      } catch (error) {
        console.error("Failed to check borders:", error);
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
        console.error("Failed to check borders:", error);
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
