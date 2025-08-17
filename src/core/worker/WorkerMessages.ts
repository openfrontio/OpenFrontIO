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
type BaseWorkerMessage = {
  type: WorkerMessageType;
  id?: string;
};

export type HeartbeatMessage = {
  type: "heartbeat";
} & BaseWorkerMessage;

// Messages from main thread to worker
export type InitMessage = {
  type: "init";
  gameStartInfo: GameStartInfo;
  clientID: ClientID;
} & BaseWorkerMessage;

export type TurnMessage = {
  type: "turn";
  turn: Turn;
} & BaseWorkerMessage;

// Messages from worker to main thread
export type InitializedMessage = {
  type: "initialized";
} & BaseWorkerMessage;

export type GameUpdateMessage = {
  type: "game_update";
  gameUpdate: GameUpdateViewData;
} & BaseWorkerMessage;

export type PlayerActionsMessage = {
  type: "player_actions";
  playerID: PlayerID;
  x: number;
  y: number;
} & BaseWorkerMessage;

export type PlayerActionsResultMessage = {
  type: "player_actions_result";
  result: PlayerActions;
} & BaseWorkerMessage;

export type PlayerProfileMessage = {
  type: "player_profile";
  playerID: number;
} & BaseWorkerMessage;

export type PlayerProfileResultMessage = {
  type: "player_profile_result";
  result: PlayerProfile;
} & BaseWorkerMessage;

export type PlayerBorderTilesMessage = {
  type: "player_border_tiles";
  playerID: PlayerID;
} & BaseWorkerMessage;

export type PlayerBorderTilesResultMessage = {
  type: "player_border_tiles_result";
  result: PlayerBorderTiles;
} & BaseWorkerMessage;

export type AttackAveragePositionMessage = {
  type: "attack_average_position";
  playerID: number;
  attackID: string;
} & BaseWorkerMessage;

export type AttackAveragePositionResultMessage = {
  type: "attack_average_position_result";
  x: number | null;
  y: number | null;
} & BaseWorkerMessage;

export type TransportShipSpawnMessage = {
  type: "transport_ship_spawn";
  playerID: PlayerID;
  targetTile: TileRef;
} & BaseWorkerMessage;

export type TransportShipSpawnResultMessage = {
  type: "transport_ship_spawn_result";
  result: TileRef | false;
} & BaseWorkerMessage;

// Union types for type safety
export type MainThreadMessage =
  | HeartbeatMessage
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
