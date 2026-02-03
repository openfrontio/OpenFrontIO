import version from "resources/version.txt?raw";
import { Theme } from "../configuration/Config";
import { PastelTheme } from "../configuration/PastelTheme";
import { PastelThemeDark } from "../configuration/PastelThemeDark";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { PlayerID } from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  BrokeAllianceUpdate,
  EmbargoUpdate,
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "../game/GameUpdates";

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
let dirtyTiles: DirtyTileQueue | null = null;
let dirtyTilesOverflow = false;
let renderTileState: Uint16Array | null = null;

let simPumpScheduled = false;
function scheduleSimPump(): void {
  if (simPumpScheduled) {
    return;
  }
  simPumpScheduled = true;

  setTimeout(async () => {
    simPumpScheduled = false;
    if (!gameRunner) {
      return;
    }
    const gr = await gameRunner;
    gr.executeNextTick();
    if (gr.hasPendingTurns()) {
      scheduleSimPump();
    }
  }, 0);
}

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  // skip if ErrorUpdate
  if (!("updates" in gu)) {
    return;
  }

  // Keep renderer-side adapter in sync (palette/relations/etc).
  const viewUpdateDidWork = (renderer as any)?.updateGameView?.(gu) === true;

  // Uploading relations is expensive; only refresh when diplomacy changes,
  // and only for the affected player pairs.
  const updates = gu.updates;
  let relationsChanged = false;
  if (renderer) {
    const markPair = (aSmallId: number, bSmallId: number) => {
      const r: any = renderer as any;
      if (r?.markRelationsPairDirty) {
        r.markRelationsPairDirty(aSmallId, bSmallId);
        relationsChanged = true;
      } else if (r?.markRelationsDirty) {
        // Fallback for older/other renderers.
        r.markRelationsDirty();
        relationsChanged = true;
      }
    };

    for (const e of updates[GameUpdateType.EmbargoEvent] as EmbargoUpdate[]) {
      markPair(e.playerID, e.embargoedID);
    }
    for (const e of updates[
      GameUpdateType.AllianceRequestReply
    ] as AllianceRequestReplyUpdate[]) {
      if (e.accepted) {
        markPair(e.request.requestorID, e.request.recipientID);
      }
    }
    for (const e of updates[
      GameUpdateType.BrokeAlliance
    ] as BrokeAllianceUpdate[]) {
      markPair(e.traitorID, e.betrayedID);
    }
    for (const e of updates[
      GameUpdateType.AllianceExpired
    ] as AllianceExpiredUpdate[]) {
      markPair(e.player1ID, e.player2ID);
    }
  }

  // Flush simulation-derived dirty tiles into the renderer before running
  // compute passes for this tick.
  if (renderer && dirtyTiles) {
    let didWork = false;
    if (viewUpdateDidWork) {
      didWork = true;
    }
    if (relationsChanged) {
      didWork = true;
    }
    if (dirtyTilesOverflow) {
      dirtyTilesOverflow = false;
      dirtyTiles.clear();
      renderer.markAllDirty();
      didWork = true;
    } else {
      const pending = dirtyTiles.pendingCount();
      if (pending > 0) {
        const tiles = dirtyTiles.drain(pending);
        for (const tile of tiles) {
          renderer.markTile(tile);
        }
        didWork = true;
      }
    }

    // Run compute passes at simulation tick cadence (not at render FPS).
    if (didWork) {
      renderer.tick();
    }
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
      // Heartbeat is a high-frequency "wake up" signal from the main thread.
      // Coalesce it and run simulation work in small slices to avoid backlog.
      scheduleSimPump();
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
          renderTileState = new Uint16Array(gr.game.tileStateView());

          gr.tileUpdateSink = (packedUpdate) => {
            if (!dirtyTiles) {
              return;
            }

            const tile = Number(packedUpdate >> 16n) as TileRef;
            const state = Number(packedUpdate & 0xffffn);
            if (renderTileState) {
              renderTileState[tile] = state;
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
        gr.addTurn(message.turn);
        scheduleSimPump();
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

        renderTileState ??= new Uint16Array(gr.game.tileStateView());
        await renderer.init(
          message.offscreenCanvas,
          gr,
          theme,
          myClientID,
          cosmeticsByClientID,
          renderTileState,
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
        if ("viewSize" in message && message.viewSize) {
          renderer.setViewSize(message.viewSize.width, message.viewSize.height);
        }
        if ("viewTransform" in message && message.viewTransform) {
          renderer.setViewTransform(
            message.viewTransform.scale,
            message.viewTransform.offsetX,
            message.viewTransform.offsetY,
          );
        }
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
