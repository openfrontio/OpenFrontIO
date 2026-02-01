import version from "resources/version.txt?raw";
import { Theme } from "../configuration/Config";
import { PastelTheme } from "../configuration/PastelTheme";
import { PastelThemeDark } from "../configuration/PastelThemeDark";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { loadTerrainMap, TerrainMapData } from "../game/TerrainMapLoader";
import { createGameRunner, GameRunner } from "../GameRunner";
import { GameStartInfo } from "../Schemas";
import {
  AttackAveragePositionResultMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerProfileResultMessage,
  RendererReadyMessage,
  TransportShipSpawnResultMessage,
  WorkerMessage,
} from "./WorkerMessages";
import { WorkerTerritoryRenderer } from "./WorkerTerritoryRenderer";

const ctx: Worker = self as any;
let gameRunner: Promise<GameRunner> | null = null;
let gameStartInfo: GameStartInfo | null = null;
const mapLoader = new FetchGameMapLoader(`/maps`, version);
const MAX_TICKS_PER_HEARTBEAT = 4;
let renderer: WorkerTerritoryRenderer | null = null;
let mapData: TerrainMapData | null = null;

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }
  // Update renderer with game update
  if (renderer) {
    renderer.updateGameView(gu);
  }
  sendMessage({
    type: "game_update",
    gameUpdate: gu,
  });
}

function sendMessage(message: WorkerMessage) {
  ctx.postMessage(message);
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "heartbeat": {
      const gr = await gameRunner;
      if (!gr) {
        break;
      }
      const ticksToRun = Math.min(gr.pendingTurns(), MAX_TICKS_PER_HEARTBEAT);
      for (let i = 0; i < ticksToRun; i++) {
        if (!gr.executeNextTick()) {
          break;
        }
      }
      break;
    }
    case "init":
      try {
        gameStartInfo = message.gameStartInfo;
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

    case "init_renderer":
      try {
        if (!gameRunner || !gameStartInfo) {
          throw new Error("Game runner not initialized");
        }
        const gr = await gameRunner;

        // Load map data if not already loaded
        // Use gameStartInfo.config which has the original game map info
        mapData ??= await loadTerrainMap(
          gameStartInfo.config.gameMap,
          gameStartInfo.config.gameMapSize,
          mapLoader,
        );

        // Create theme based on darkMode flag from main thread
        // (can't access userSettings in worker, so it's passed from main thread)
        const theme: Theme = message.darkMode
          ? new PastelThemeDark()
          : new PastelTheme();

        renderer = new WorkerTerritoryRenderer();

        await renderer.init(message.offscreenCanvas, gr, mapData, theme);

        sendMessage({
          type: "renderer_ready",
          id: message.id,
          ok: true,
        } as RendererReadyMessage);
      } catch (error) {
        console.error("Failed to initialize renderer:", error);
        sendMessage({
          type: "renderer_ready",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } as RendererReadyMessage);
        renderer = null;
      }
      break;

    case "set_view_size":
      if (renderer) {
        renderer.setViewSize(message.width, message.height);
      }
      break;

    case "set_view_transform":
      if (renderer) {
        renderer.setViewTransform(
          message.scale,
          message.offsetX,
          message.offsetY,
        );
      }
      break;

    case "set_alternative_view":
      if (renderer) {
        renderer.setAlternativeView(message.enabled);
      }
      break;

    case "set_highlighted_owner":
      if (renderer) {
        renderer.setHighlightedOwnerId(message.ownerSmallId);
      }
      break;

    case "set_shader_settings":
      if (renderer) {
        if (message.territoryShader) {
          renderer.setTerritoryShader(message.territoryShader);
        }
        if (message.territoryShaderParams0 && message.territoryShaderParams1) {
          renderer.setTerritoryShaderParams(
            message.territoryShaderParams0,
            message.territoryShaderParams1,
          );
        }
        if (message.terrainShader) {
          renderer.setTerrainShader(message.terrainShader);
        }
        if (message.terrainShaderParams0 && message.terrainShaderParams1) {
          renderer.setTerrainShaderParams(
            message.terrainShaderParams0,
            message.terrainShaderParams1,
          );
        }
        if (message.preSmoothing) {
          renderer.setPreSmoothing(
            message.preSmoothing.enabled,
            message.preSmoothing.shaderPath,
            message.preSmoothing.params0,
          );
        }
        if (message.postSmoothing) {
          renderer.setPostSmoothing(
            message.postSmoothing.enabled,
            message.postSmoothing.shaderPath,
            message.postSmoothing.params0,
          );
        }
      }
      break;

    case "mark_tile":
      if (renderer) {
        renderer.markTile(message.tile);
      }
      break;

    case "mark_all_dirty":
      if (renderer) {
        renderer.markAllDirty();
      }
      break;

    case "refresh_palette":
      if (renderer) {
        renderer.refreshPalette();
      }
      break;

    case "refresh_terrain":
      if (renderer) {
        renderer.refreshTerrain();
      }
      break;

    case "tick_renderer":
      if (renderer) {
        const start = performance.now();
        renderer.tick();
        const computeMs = performance.now() - start;
        sendMessage({
          type: "renderer_metrics",
          computeMs,
        });
      }
      break;

    case "render_frame":
      if (renderer) {
        renderer.render();
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
