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

export type GameUpdateViewData = {
  tick: number;
  updates: GameUpdates;
  packedTileUpdates: BigUint64Array;
  playerNameViewData: Record<string, NameViewData>;
};

export type ErrorUpdate = {
  errMsg: string;
  stack?: string;
};

export enum GameUpdateType {
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  AllianceExtension,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  BonusEvent,
  RailroadEvent,
  ConquestEvent,
}

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
  | ConquestUpdate;

export type BonusEventUpdate = {
  type: GameUpdateType.BonusEvent;
  player: PlayerID;
  tile: TileRef;
  gold: number;
  troops: number;
};

export enum RailType {
  VERTICAL,
  HORIZONTAL,
  TOP_LEFT,
  TOP_RIGHT,
  BOTTOM_LEFT,
  BOTTOM_RIGHT,
}

export type RailTile = {
  tile: TileRef;
  railType: RailType;
};

export type RailroadUpdate = {
  type: GameUpdateType.RailroadEvent;
  isActive: boolean;
  railTiles: RailTile[];
};

export type ConquestUpdate = {
  type: GameUpdateType.ConquestEvent;
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  gold: Gold;
};

export type TileUpdateWrapper = {
  type: GameUpdateType.Tile;
  update: TileUpdate;
};

export type UnitUpdate = {
  type: GameUpdateType.Unit;
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
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  constructionType?: UnitType;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  trainType?: TrainType; // Only for trains
  loaded?: boolean; // Only for trains
};

export type AttackUpdate = {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
};

export type PlayerUpdate = {
  type: GameUpdateType.Player;
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
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  alliances: AllianceView[];
  hasSpawned: boolean;
  betrayals?: bigint;
};

export type AllianceView = {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
};

export type AllianceRequestUpdate = {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
};

export type AllianceRequestReplyUpdate = {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
};

export type BrokeAllianceUpdate = {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
};

export type AllianceExpiredUpdate = {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
};

export type AllianceExtensionUpdate = {
  type: GameUpdateType.AllianceExtension;
  playerID: number;
  allianceID: number;
};

export type TargetPlayerUpdate = {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
};

export type EmojiUpdate = {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
};

export type DisplayMessageUpdate = {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
};

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export type WinUpdate = {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
};

export type HashUpdate = {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
};

export type UnitIncomingUpdate = {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
};
