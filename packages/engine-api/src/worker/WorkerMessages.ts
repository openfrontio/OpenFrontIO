import { TileRef } from "../game/GameMap";
import {
  BuildableUnit,
  Difficulty,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/GameTypes";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { MapFiles } from "../game/MapFiles";
import { ClientID, GameStartInfo, Turn } from "../Schemas";

export type WorkerMessageType =
  | "init"
  | "connect"
  | "initialized"
  | "init_error"
  | "turn"
  | "run_turns"
  | "run_turns_result"
  | "game_update"
  | "game_update_batch"
  | "game_error"
  | "player_actions"
  | "player_actions_result"
  | "player_actions_error"
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
  | "snapshot"
  | "snapshot_result"
  | "extract_snapshot"
  | "extract_snapshot_result"
  | "extract_snapshot_error";

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
  /** The game's map. The engine loads nothing itself. */
  map: MapFiles;
  /** Resume from this game snapshot instead of starting a new game. */
  snapshot?: Uint8Array;
}

/**
 * From now on, take messages from this port and answer on it, not the page.
 * Lets the page start the engine for another worker (replay processing) and
 * leave the two to talk directly.
 */
export interface ConnectMessage extends BaseWorkerMessage {
  type: "connect";
  port: MessagePort;
}

export interface TurnMessage extends BaseWorkerMessage {
  type: "turn";
  turn: Turn;
}

/**
 * Runs the turns at once, without yielding between ticks, and answers with
 * a RunTurnsResultMessage. For replay processing, which wants the game as
 * fast as it runs rather than in time with the turns.
 */
export interface RunTurnsMessage extends BaseWorkerMessage {
  type: "run_turns";
  turns: Turn[];
}

// Messages from worker to main thread
export interface InitializedMessage extends BaseWorkerMessage {
  type: "initialized";
  initialUpdate?: GameUpdateViewData;
}

/** The game couldn't be started; `error` says why. */
export interface InitErrorMessage extends BaseWorkerMessage {
  type: "init_error";
  error: string;
}

export interface GameUpdateMessage extends BaseWorkerMessage {
  type: "game_update";
  gameUpdate: GameUpdateViewData;
}

export interface GameUpdateBatchMessage extends BaseWorkerMessage {
  type: "game_update_batch";
  gameUpdates: GameUpdateViewData[];
}

/**
 * One update per tick that ran. On a tick error the run stops there: fewer
 * updates than turns, and `error` says why.
 */
export interface RunTurnsResultMessage extends BaseWorkerMessage {
  type: "run_turns_result";
  gameUpdates: GameUpdateViewData[];
  error?: ErrorUpdate;
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

export interface PlayerActionsErrorMessage extends BaseWorkerMessage {
  type: "player_actions_error";
  error: string;
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

export interface AttackClusteredPositionsResultMessage extends BaseWorkerMessage {
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

export interface SnapshotMessage extends BaseWorkerMessage {
  type: "snapshot";
  gitCommit?: string;
}

export interface SnapshotResultMessage extends BaseWorkerMessage {
  type: "snapshot_result";
  /** Uncompressed; null if the snapshot failed (see the worker log). */
  snapshot: Uint8Array | null;
  tick: number;
}

export interface ExtractSnapshotMessage extends BaseWorkerMessage {
  type: "extract_snapshot";
  gameStartInfo: GameStartInfo;
  turns: Turn[];
  map: MapFiles;
  targetTick: number;
  chosenPlayerID: PlayerID;
  localClientID: ClientID;
  difficulty?: Difficulty;
  newGameID?: string;
}

export interface ExtractSnapshotResultMessage extends BaseWorkerMessage {
  type: "extract_snapshot_result";
  snapshot: Uint8Array;
  gameStartInfo: GameStartInfo;
}

export interface ExtractSnapshotErrorMessage extends BaseWorkerMessage {
  type: "extract_snapshot_error";
  error: string;
}

// Union types for type safety
export type MainThreadMessage =
  | InitMessage
  | ConnectMessage
  | TurnMessage
  | RunTurnsMessage
  | PlayerActionsMessage
  | PlayerBuildablesMessage
  | PlayerProfileMessage
  | PlayerBorderTilesMessage
  | AttackClusteredPositionsMessage
  | TransportShipSpawnMessage
  | SnapshotMessage
  | ExtractSnapshotMessage;

// Message send from worker
export type WorkerMessage =
  | InitializedMessage
  | InitErrorMessage
  | GameUpdateMessage
  | GameUpdateBatchMessage
  | RunTurnsResultMessage
  | GameErrorMessage
  | PlayerActionsResultMessage
  | PlayerActionsErrorMessage
  | PlayerBuildablesResultMessage
  | PlayerProfileResultMessage
  | PlayerBorderTilesResultMessage
  | AttackClusteredPositionsResultMessage
  | TransportShipSpawnResultMessage
  | SnapshotResultMessage
  | ExtractSnapshotResultMessage
  | ExtractSnapshotErrorMessage;
