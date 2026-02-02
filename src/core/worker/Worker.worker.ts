import version from "resources/version.txt?raw";
import { Theme } from "../configuration/Config";
import { PastelTheme } from "../configuration/PastelTheme";
import { PastelThemeDark } from "../configuration/PastelThemeDark";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { PlayerID } from "../game/Game";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { loadTerrainMap, TerrainMapData } from "../game/TerrainMapLoader";
import { createGameRunner, GameRunner } from "../GameRunner";
import { ClientID, GameStartInfo, PlayerCosmetics } from "../Schemas";
import { DirtyTileQueue } from "./DirtyTileQueue";
import { WorkerCanvas2DRenderer } from "./WorkerCanvas2DRenderer";
import {
  AttackAveragePositionResultMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerProfileResultMessage,
  RendererReadyMessage,
  TileContextResultMessage,
  TransportShipSpawnResultMessage,
  WorkerMessage,
} from "./WorkerMessages";
import { WorkerTerritoryRenderer } from "./WorkerTerritoryRenderer";

const ctx: Worker = self as any;
let gameRunner: Promise<GameRunner> | null = null;
let gameStartInfo: GameStartInfo | null = null;
let myClientID: ClientID | null = null;
const mapLoader = new FetchGameMapLoader(`/maps`, version);
const MAX_TICKS_PER_HEARTBEAT = 4;
let renderer: WorkerTerritoryRenderer | WorkerCanvas2DRenderer | null = null;
let mapData: TerrainMapData | null = null;
let dirtyTiles: DirtyTileQueue | null = null;
let dirtyTilesOverflow = false;

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }

  // Flush simulation-derived dirty tiles into the renderer before running
  // compute passes for this tick.
  if (renderer && dirtyTiles) {
    if (dirtyTilesOverflow) {
      dirtyTilesOverflow = false;
      dirtyTiles.clear();
      renderer.markAllDirty();
    } else {
      const tiles = dirtyTiles.drain(dirtyTiles.pendingCount());
      for (const tile of tiles) {
        renderer.markTile(tile);
      }
    }

    // Run compute passes at simulation tick cadence (not at render FPS).
    renderer.tick();
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
        myClientID = message.clientID;
        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          mapLoader,
          gameUpdate,
        ).then((gr) => {
          const numTiles = gr.game.width() * gr.game.height();
          // Capacity is bounded; on overflow we fall back to markAllDirty().
          dirtyTiles = new DirtyTileQueue(numTiles, Math.max(4096, numTiles));
          dirtyTilesOverflow = false;

          gr.tileUpdateSink = (tile) => {
            if (!dirtyTiles) {
              return;
            }
            const mark = (t: any) => {
              if (!dirtyTiles!.mark(t)) {
                dirtyTilesOverflow = true;
              }
            };
            mark(tile);
            gr.game.forEachNeighbor(tile, (n) => mark(n));
          };

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

    case "tile_context":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }
      try {
        const gr = await gameRunner;
        const tile = message.tile;
        const hasOwner = gr.game.hasOwner(tile);
        const ownerSmallId = hasOwner ? gr.game.ownerID(tile) : null;
        let ownerId: PlayerID | null = null;
        if (hasOwner) {
          const owner = gr.game.owner(tile);
          ownerId = owner && owner.isPlayer() ? owner.id() : null;
        }
        sendMessage({
          type: "tile_context_result",
          id: message.id,
          result: {
            hasOwner,
            ownerSmallId,
            ownerId,
            hasFallout: gr.game.hasFallout(tile),
            isDefended: gr.game.isDefended(tile),
          },
        } as TileContextResultMessage);
      } catch (error) {
        console.error("Failed to fetch tile context:", error);
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

        (renderer as any)?.dispose?.();
        renderer = null;

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

        const cosmeticsByClientID = new Map<ClientID, PlayerCosmetics>();
        for (const p of gameStartInfo.players) {
          cosmeticsByClientID.set(
            p.clientID,
            (p.cosmetics ?? {}) as PlayerCosmetics,
          );
        }

        const backend = message.backend ?? "webgpu";
        renderer =
          backend === "canvas2d"
            ? new WorkerCanvas2DRenderer()
            : new WorkerTerritoryRenderer();

        await renderer.init(
          message.offscreenCanvas,
          gr,
          mapData,
          theme,
          myClientID,
          cosmeticsByClientID,
        );

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

    case "set_patterns_enabled":
      if (renderer) {
        renderer.setPatternsEnabled(message.enabled);
        renderer.tick();
      }
      break;

    case "set_palette":
      if (renderer) {
        renderer.setPaletteFromBytes(
          message.paletteWidth,
          message.maxSmallId,
          message.row0,
          message.row1,
        );
        renderer.tick();
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
        const r: any = renderer as any;
        if (message.territoryShader) {
          r.setTerritoryShader?.(message.territoryShader);
        }
        if (message.territoryShaderParams0 && message.territoryShaderParams1) {
          r.setTerritoryShaderParams?.(
            message.territoryShaderParams0,
            message.territoryShaderParams1,
          );
        }
        if (message.terrainShader) {
          r.setTerrainShader?.(message.terrainShader);
        }
        if (message.terrainShaderParams0 && message.terrainShaderParams1) {
          r.setTerrainShaderParams?.(
            message.terrainShaderParams0,
            message.terrainShaderParams1,
          );
        }
        if (message.preSmoothing) {
          r.setPreSmoothing?.(
            message.preSmoothing.enabled,
            message.preSmoothing.shaderPath,
            message.preSmoothing.params0,
          );
        }
        if (message.postSmoothing) {
          r.setPostSmoothing?.(
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
        renderer.tick();
      }
      break;

    case "refresh_palette":
      if (renderer) {
        renderer.refreshPalette();
        renderer.tick();
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
