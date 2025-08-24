import version from "../../../resources/version.txt";
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

const ctx: Worker = self as unknown as Worker;
let gameRunner: Promise<GameRunner> | null = null;
const mapLoader = new FetchGameMapLoader("/maps", version);

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }
  sendMessage({
    gameUpdate: gu,
    type: "game_update",
  });
}

function sendMessage(message: WorkerMessage) {
  ctx.postMessage(message);
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "heartbeat":
      (await gameRunner)?.executeNextTick();
      break;
    case "init":
      try {
        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          mapLoader,
          gameUpdate,
        ).then((gr) => {
          sendMessage({
            id: message.id,
            type: "initialized",
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
        await gr.addTurn(message.turn);
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
          id: message.id,
          result: actions,
          type: "player_actions_result",
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
          id: message.id,
          result: profile,
          type: "player_profile_result",
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
          id: message.id,
          result: borderTiles,
          type: "player_border_tiles_result",
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
          id: message.id,
          type: "attack_average_position_result",
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
          id: message.id,
          result: spawnTile,
          type: "transport_ship_spawn_result",
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
