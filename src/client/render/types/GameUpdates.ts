/**
 * Game update type constants and typed event payloads.
 *
 * Shared contract between shim (live game) and codec (replay).
 * Values must match the LIVE deployed game's GameUpdates.ts.
 */

// ---------------------------------------------------------------------------
// GameUpdateType constants
// ---------------------------------------------------------------------------

export const GameUpdateType = {
  Tile: 0,
  Unit: 1,
  Player: 2,
  DisplayEvent: 3,
  DisplayChatEvent: 4,
  AllianceRequest: 5,
  AllianceRequestReply: 6,
  BrokeAlliance: 7,
  AllianceExpired: 8,
  AllianceExtension: 9,
  TargetPlayer: 10,
  Emoji: 11,
  Win: 12,
  Hash: 13,
  UnitIncoming: 14,
  BonusEvent: 15,
  RailroadDestructionEvent: 16,
  RailroadConstructionEvent: 17,
  RailroadSnapEvent: 18,
  ConquestEvent: 19,
  EmbargoEvent: 20,
  GamePaused: 21,
  NukeDetonation: 22,
} as const;

// ---------------------------------------------------------------------------
// Typed update payloads (keyed by GameUpdateType values)
// ---------------------------------------------------------------------------

export type PlayerType = "HUMAN" | "NATION" | "BOT";

export interface UnitEventUpdate {
  id: number;
  unitType: string;
  ownerID: number;
  pos: number;
  lastPos?: number;
  isActive: boolean;
  level: number;
  underConstruction?: boolean;
  markedForDeletion: number | false;
  lastOwnerID?: number;
  trainType?: string;
  loaded?: boolean;
  targetUnitId?: number;
  targetTile?: number;
  health?: number;
  troops?: number;
  reachedTarget?: boolean;
  retreating?: boolean;
  targetable?: boolean;
  hasTrainStation?: boolean;
  missileTimerQueue?: number[];
}

export interface PlayerEventUpdate {
  id: string;
  clientID?: string | null;
  smallID: number;
  displayName: string;
  playerType: PlayerType;
  team?: string | null;
  isAlive: boolean;
  troops: number;
  gold: bigint;
  tilesOwned: number;
  outgoingAttacks?: AttackEventUpdate[];
  incomingAttacks?: AttackEventUpdate[];
  allies?: number[];
  betrayals?: number;
}

export interface AttackEventUpdate {
  troops: number;
}

export interface WinUpdate {
  /** Winner tuple: ["player", ...playerIds] or ["team"|"nation", name, ...playerIds] */
  winner?: [string, ...string[]];
}

export interface AllianceReplyUpdate {
  accepted: boolean;
  request?: { requestorID: number; recipientID: number };
}

export interface BrokeAllianceUpdate {
  traitorID: number;
  betrayedID: number;
}

export interface AllianceExpiredUpdate {
  player1ID: number;
  player2ID: number;
}

export interface EmbargoUpdate {
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface TargetPlayerUpdate {
  playerID: number;
  targetID: number;
}

export interface BonusUpdate {
  player: string;
  tile?: number;
  gold: number;
  troops: number;
}

export interface UnitIncomingUpdate {
  playerID: number;
}

export interface EmojiUpdate {
  emoji?: { senderID: number; message: string };
}

export interface DisplayMessageUpdate {
  messageType: number;
  playerID: number | null;
  goldAmount?: bigint | number;
  params?: Record<string, string | number>;
}

export interface GamePausedUpdate {
  paused: boolean;
}

export interface RailroadConstructionUpdate {
  id: number;
  tiles: number[];
}

export interface RailroadDestructionUpdate {
  id: number;
}

export interface RailroadSnapUpdate {
  originalId: number;
  newId1: number;
  newId2: number;
  tiles1: number[];
  tiles2: number[];
}
