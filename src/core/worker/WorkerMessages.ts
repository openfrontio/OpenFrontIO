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
  | "init"
  | "initialized"
  | "turn"
  | "game_update"
  | "player_actions"
  | "player_actions_result"
  | "player_profile"
  | "player_profile_result"
  | "player_border_tiles"
  | "player_border_tiles_result"
  | "attack_average_position"
  | "attack_average_position_result"
  | "transport_ship_spawn"
  | "transport_ship_spawn_result";

// Base interface for all messages
interface BaseWorkerMessage {
  type: WorkerMessageType;
  id?: string;
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

// Union types for type safety
export type MainThreadMessage =
  | InitMessage
  | TurnMessage
  | PlayerActionsMessage
  | PlayerProfileMessage
  | PlayerBorderTilesMessage
  | AttackAveragePositionMessage
  | TransportShipSpawnMessage;

// Message send from worker
export type WorkerMessage =
  | InitializedMessage
  | GameUpdateMessage
  | PlayerActionsResultMessage
  | PlayerProfileResultMessage
  | PlayerBorderTilesResultMessage
  | AttackAveragePositionResultMessage
  | TransportShipSpawnResultMessage;
