import {
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";

export type WorkerMessageType =
  | "heartbeat"
  | "init"
  | "initialized"
  | "turn"
  | "game_update"
  | "tile_context"
  | "tile_context_result"
  | "player_actions"
  | "player_actions_result"
  | "player_profile"
  | "player_profile_result"
  | "player_border_tiles"
  | "player_border_tiles_result"
  | "attack_average_position"
  | "attack_average_position_result"
  | "transport_ship_spawn"
  | "transport_ship_spawn_result"
  | "init_renderer"
  | "renderer_ready"
  | "set_patterns_enabled"
  | "set_palette"
  | "set_view_size"
  | "set_view_transform"
  | "set_alternative_view"
  | "set_highlighted_owner"
  | "set_shader_settings"
  | "mark_tile"
  | "mark_all_dirty"
  | "refresh_palette"
  | "refresh_terrain"
  | "tick_renderer"
  | "render_frame"
  | "renderer_metrics";

// Base interface for all messages
interface BaseWorkerMessage {
  type: WorkerMessageType;
  id?: string;
}

export interface HeartbeatMessage extends BaseWorkerMessage {
  type: "heartbeat";
}

// Messages from main thread to worker
export interface InitMessage extends BaseWorkerMessage {
  type: "init";
  gameStartInfo: GameStartInfo;
  clientID: ClientID;
}

export interface TurnMessage extends BaseWorkerMessage {
  type: "turn";
  turn: Turn;
}

// Messages from worker to main thread
export interface InitializedMessage extends BaseWorkerMessage {
  type: "initialized";
}

export interface GameUpdateMessage extends BaseWorkerMessage {
  type: "game_update";
  gameUpdate: GameUpdateViewData;
}

export interface TileContext {
  hasOwner: boolean;
  ownerSmallId: number | null;
  ownerId: PlayerID | null;
  hasFallout: boolean;
  isDefended: boolean;
}

export interface TileContextMessage extends BaseWorkerMessage {
  type: "tile_context";
  tile: TileRef;
}

export interface TileContextResultMessage extends BaseWorkerMessage {
  type: "tile_context_result";
  result: TileContext;
}

export interface PlayerActionsMessage extends BaseWorkerMessage {
  type: "player_actions";
  playerID: PlayerID;
  x?: number;
  y?: number;
}

export interface PlayerActionsResultMessage extends BaseWorkerMessage {
  type: "player_actions_result";
  result: PlayerActions;
}

export interface PlayerProfileMessage extends BaseWorkerMessage {
  type: "player_profile";
  playerID: number;
}

export interface PlayerProfileResultMessage extends BaseWorkerMessage {
  type: "player_profile_result";
  result: PlayerProfile;
}

export interface PlayerBorderTilesMessage extends BaseWorkerMessage {
  type: "player_border_tiles";
  playerID: PlayerID;
}

export interface PlayerBorderTilesResultMessage extends BaseWorkerMessage {
  type: "player_border_tiles_result";
  result: PlayerBorderTiles;
}

export interface AttackAveragePositionMessage extends BaseWorkerMessage {
  type: "attack_average_position";
  playerID: number;
  attackID: string;
}

export interface AttackAveragePositionResultMessage extends BaseWorkerMessage {
  type: "attack_average_position_result";
  x: number | null;
  y: number | null;
}

export interface TransportShipSpawnMessage extends BaseWorkerMessage {
  type: "transport_ship_spawn";
  playerID: PlayerID;
  targetTile: TileRef;
}

export interface TransportShipSpawnResultMessage extends BaseWorkerMessage {
  type: "transport_ship_spawn_result";
  result: TileRef | false;
}

// Renderer messages from main thread to worker
export interface InitRendererMessage extends BaseWorkerMessage {
  type: "init_renderer";
  offscreenCanvas: OffscreenCanvas;
  darkMode: boolean; // Whether to use dark theme
  backend?: "webgpu" | "canvas2d";
}

export interface SetPatternsEnabledMessage extends BaseWorkerMessage {
  type: "set_patterns_enabled";
  enabled: boolean;
}

export interface SetPaletteMessage extends BaseWorkerMessage {
  type: "set_palette";
  paletteWidth: number;
  maxSmallId: number;
  row0: Uint8Array;
  row1: Uint8Array;
}

export interface SetViewSizeMessage extends BaseWorkerMessage {
  type: "set_view_size";
  width: number;
  height: number;
}

export interface SetViewTransformMessage extends BaseWorkerMessage {
  type: "set_view_transform";
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SetAlternativeViewMessage extends BaseWorkerMessage {
  type: "set_alternative_view";
  enabled: boolean;
}

export interface SetHighlightedOwnerMessage extends BaseWorkerMessage {
  type: "set_highlighted_owner";
  ownerSmallId: number | null;
}

export interface SetShaderSettingsMessage extends BaseWorkerMessage {
  type: "set_shader_settings";
  territoryShader?: string;
  territoryShaderParams0?: number[];
  territoryShaderParams1?: number[];
  terrainShader?: string;
  terrainShaderParams0?: number[];
  terrainShaderParams1?: number[];
  preSmoothing?: {
    enabled: boolean;
    shaderPath: string;
    params0: number[];
  };
  postSmoothing?: {
    enabled: boolean;
    shaderPath: string;
    params0: number[];
  };
}

export interface MarkTileMessage extends BaseWorkerMessage {
  type: "mark_tile";
  tile: TileRef;
}

export interface MarkAllDirtyMessage extends BaseWorkerMessage {
  type: "mark_all_dirty";
}

export interface RefreshPaletteMessage extends BaseWorkerMessage {
  type: "refresh_palette";
}

export interface RefreshTerrainMessage extends BaseWorkerMessage {
  type: "refresh_terrain";
}

export interface TickRendererMessage extends BaseWorkerMessage {
  type: "tick_renderer";
}

export interface RenderFrameMessage extends BaseWorkerMessage {
  type: "render_frame";
}

// Renderer messages from worker to main thread
export interface RendererReadyMessage extends BaseWorkerMessage {
  type: "renderer_ready";
  ok: boolean;
  error?: string;
}

export interface RendererMetricsMessage extends BaseWorkerMessage {
  type: "renderer_metrics";
  computeMs: number;
}

// Union types for type safety
export type MainThreadMessage =
  | HeartbeatMessage
  | InitMessage
  | TurnMessage
  | TileContextMessage
  | PlayerActionsMessage
  | PlayerProfileMessage
  | PlayerBorderTilesMessage
  | AttackAveragePositionMessage
  | TransportShipSpawnMessage
  | InitRendererMessage
  | SetPatternsEnabledMessage
  | SetPaletteMessage
  | SetViewSizeMessage
  | SetViewTransformMessage
  | SetAlternativeViewMessage
  | SetHighlightedOwnerMessage
  | SetShaderSettingsMessage
  | MarkTileMessage
  | MarkAllDirtyMessage
  | RefreshPaletteMessage
  | RefreshTerrainMessage
  | TickRendererMessage
  | RenderFrameMessage;

// Message send from worker
export type WorkerMessage =
  | InitializedMessage
  | GameUpdateMessage
  | TileContextResultMessage
  | PlayerActionsResultMessage
  | PlayerProfileResultMessage
  | PlayerBorderTilesResultMessage
  | AttackAveragePositionResultMessage
  | TransportShipSpawnResultMessage
  | RendererReadyMessage
  | RendererMetricsMessage;
