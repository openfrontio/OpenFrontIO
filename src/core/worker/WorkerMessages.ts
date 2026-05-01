import {
  BuildableUnit,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";

export type WorkerMessageType =
  | "init"
  | "initialized"
  | "turn"
  | "game_update"
  | "game_update_batch"
  | "game_error"
  | "player_actions"
  | "player_actions_result"
  | "player_buildables"
  | "player_buildables_result"
  | "player_profile"
  | "player_profile_result"
  | "player_border_tiles"
  | "player_border_tiles_result"
  | "attack_clustered_positions"
  | "attack_clustered_positions_result"
  | "transport_ship_spawn"
  | "transport_ship_spawn_result"
  | "trampoline_error";

// Base interface for all messages
interface BaseWorkerMessage {
  type: WorkerMessageType;
  id?: string;
}

// Messages from main thread to worker
export interface InitMessage extends BaseWorkerMessage {
  type: "init";
  gameStartInfo: GameStartInfo;
  clientID: ClientID | undefined;
  cdnBase: string;
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

export interface GameUpdateBatchMessage extends BaseWorkerMessage {
  type: "game_update_batch";
  gameUpdates: GameUpdateViewData[];
}

export interface GameErrorMessage extends BaseWorkerMessage {
  type: "game_error";
  error: ErrorUpdate;
}

export interface PlayerActionsMessage extends BaseWorkerMessage {
  type: "player_actions";
  playerID: PlayerID;
  x?: number;
  y?: number;
  units?: readonly PlayerBuildableUnitType[] | null;
}

export interface PlayerActionsResultMessage extends BaseWorkerMessage {
  type: "player_actions_result";
  result: PlayerActions;
}

export interface PlayerBuildablesMessage extends BaseWorkerMessage {
  type: "player_buildables";
  playerID: PlayerID;
  x?: number;
  y?: number;
  units?: readonly PlayerBuildableUnitType[];
}

export interface PlayerBuildablesResultMessage extends BaseWorkerMessage {
  type: "player_buildables_result";
  result: BuildableUnit[];
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

export interface AttackClusteredPositionsMessage extends BaseWorkerMessage {
  type: "attack_clustered_positions";
  playerID: number;
  attackID?: string;
}

export interface AttackClusteredPositionsResultMessage
  extends BaseWorkerMessage {
  type: "attack_clustered_positions_result";
  attacks: { id: string; positions: { x: number; y: number }[] }[];
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

// Posted by the Blob trampoline (see WorkerClient.createGameWorker) when the
// dynamic import of the real worker module fails. The real worker module
// never loaded, so no other message will ever arrive — initialize() must
// reject on this rather than wait out its timeout.
export interface TrampolineErrorMessage extends BaseWorkerMessage {
  type: "trampoline_error";
  message: string;
}

// Union types for type safety
export type MainThreadMessage =
  | InitMessage
  | TurnMessage
  | PlayerActionsMessage
  | PlayerBuildablesMessage
  | PlayerProfileMessage
  | PlayerBorderTilesMessage
  | AttackClusteredPositionsMessage
  | TransportShipSpawnMessage;

// Message send from worker
export type WorkerMessage =
  | InitializedMessage
  | GameUpdateMessage
  | GameUpdateBatchMessage
  | GameErrorMessage
  | PlayerActionsResultMessage
  | PlayerBuildablesResultMessage
  | PlayerProfileResultMessage
  | PlayerBorderTilesResultMessage
  | AttackClusteredPositionsResultMessage
  | TransportShipSpawnResultMessage
  | TrampolineErrorMessage;
