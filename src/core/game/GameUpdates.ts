import { z } from "zod";
import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  Team,
  Tick,
  TrainType,
  UnitType,
} from "./Game";
import { TileRef, TileUpdate } from "./GameMap";

export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  packedTileUpdates: BigUint64Array;
  playerNameViewData: Record<string, NameViewData>;
  tickExecutionDuration?: number;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export const GameUpdateTypeSchema = z.enum([
  "Tile",
  "Unit",
  "Player",
  "DisplayEvent",
  "DisplayChatEvent",
  "AllianceRequest",
  "AllianceRequestReply",
  "BrokeAlliance",
  "AllianceExpired",
  "AllianceExtension",
  "TargetPlayer",
  "Emoji",
  "Win",
  "Hash",
  "UnitIncoming",
  "BonusEvent",
  "RailroadEvent",
  "ConquestEvent",
  "EmbargoEvent",
]);
export type GameUpdateType = z.infer<typeof GameUpdateTypeSchema>;

export type GameUpdate =
  | TileUpdateWrapper
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | AllianceExtensionUpdate
  | BonusEventUpdate
  | RailroadUpdate
  | ConquestUpdate
  | EmbargoUpdate;

export interface BonusEventUpdate {
  type: "BonusEvent";
  player: PlayerID;
  tile: TileRef;
  gold: number;
  troops: number;
}

export const RailTypeSchema = z.enum([
  "VERTICAL",
  "HORIZONTAL",
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
]);
export type RailType = z.infer<typeof RailTypeSchema>;

export interface RailTile {
  tile: TileRef;
  railType: RailType;
}

export interface RailroadUpdate {
  type: "RailroadEvent";
  isActive: boolean;
  railTiles: RailTile[];
}

export interface ConquestUpdate {
  type: "ConquestEvent";
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  gold: Gold;
}

export interface TileUpdateWrapper {
  type: "Tile";
  update: TileUpdate;
}

export interface UnitUpdate {
  type: "Unit";
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  retreating: boolean;
  targetable: boolean;
  markedForDeletion: number | false;
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  underConstruction?: boolean;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  trainType?: TrainType; // Only for trains
  loaded?: boolean; // Only for trains
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

export interface PlayerUpdate {
  type: "Player";
  nameViewData?: NameViewData;
  clientID: ClientID | null;
  name: string;
  displayName: string;
  id: PlayerID;
  team?: Team;
  smallID: number;
  playerType: PlayerType;
  isAlive: boolean;
  isDisconnected: boolean;
  tilesOwned: number;
  gold: Gold;
  troops: number;
  allies: number[];
  embargoes: Set<PlayerID>;
  isTraitor: boolean;
  traitorRemainingTicks?: number;
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  alliances: AllianceView[];
  hasSpawned: boolean;
  betrayals: number;
  lastDeleteUnitTick: Tick;
}

export interface AllianceView {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
  hasExtensionRequest: boolean;
}

export interface AllianceRequestUpdate {
  type: "AllianceRequest";
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: "AllianceRequestReply";
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: "BrokeAlliance";
  traitorID: number;
  betrayedID: number;
}

export interface AllianceExpiredUpdate {
  type: "AllianceExpired";
  player1ID: number;
  player2ID: number;
}

export interface AllianceExtensionUpdate {
  type: "AllianceExtension";
  playerID: number;
  allianceID: number;
}

export interface TargetPlayerUpdate {
  type: "TargetPlayer";
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: "Emoji";
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: "DisplayEvent";
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
}

export type DisplayChatMessageUpdate = {
  type: "DisplayChatEvent";
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: "Win";
  allPlayersStats: AllPlayersStats;
  winner: Winner;
}

export interface HashUpdate {
  type: "Hash";
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: "UnitIncoming";
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface EmbargoUpdate {
  type: "EmbargoEvent";
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}
