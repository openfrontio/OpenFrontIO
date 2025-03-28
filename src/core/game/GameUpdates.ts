import { ClientID, PlayerStats, AllPlayersStats } from "../Schemas";
import {
  AllianceRequest,
  EmojiMessage,
  GameUpdates,
  MapPos,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  TeamName,
  Tick,
  UnitType,
} from "./Game";
import { TileRef, TileUpdate } from "./GameMap";

export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  packedTileUpdates: BigUint64Array;
  playerNameViewData: Record<number, NameViewData>;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  Tile,
  Unit,
  Player,
  DisplayEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
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
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate;

export interface TileUpdateWrapper {
  type: GameUpdateType.Tile;
  update: TileUpdate;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  dstPortId?: number; // Only for trade ships
  detonationDst?: TileRef; // Only for nukes
  warshipTargetId?: number;
  health?: number;
  constructionType?: UnitType;
  isSamCooldown?: boolean;
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

export interface PlayerUpdate {
  type: GameUpdateType.Player;
  nameViewData?: NameViewData;
  clientID: ClientID;
  flag: string;
  name: string;
  displayName: string;
  id: PlayerID;
  teamName?: TeamName;
  smallID: number;
  playerType: PlayerType;
  isAlive: boolean;
  tilesOwned: number;
  gold: number;
  population: number;
  workers: number;
  troops: number;
  targetTroopRatio: number;
  allies: number[];
  embargoes: Set<PlayerID>;
  isTraitor: boolean;
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  stats: PlayerStats;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  playerID: number | null;
}

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  // Player id or team name.
  winner: number | TeamName;
  winnerType: "player" | "team";
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}
