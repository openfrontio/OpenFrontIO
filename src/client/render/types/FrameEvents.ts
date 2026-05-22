import type {
  ConquestFx,
  DeadUnitFx,
  PlayerState,
  UnitState,
} from "./Renderer";

// ── Supporting event types ──────────────────────────────────────────────

export interface AllianceFormedEvent {
  requestorID: number;
  recipientID: number;
}

export interface AllianceBrokenEvent {
  traitorID: number;
  betrayedID: number;
}

export interface AllianceExpiredEvent {
  player1ID: number;
  player2ID: number;
}

export interface EmbargoEvent {
  type: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface TargetEvent {
  playerID: number;
  targetID: number;
}

export interface BonusEvent {
  playerID: string;
  smallID: number;
  tile: number;
  gold: number;
  troops: number;
}

export interface NukeIncomingEvent {
  playerID: number;
}

export interface EmojiEvent {
  senderID: number;
  message: string;
}

export interface DisplayMessageEvent {
  messageType: number;
  playerID: number | null;
  goldAmount?: number;
  params?: Record<string, string | number>;
}

export interface WinEvent {
  /** Tuple: ["player", ...playerIds] or ["team"|"nation", name, ...playerIds] */
  winner: string[];
}

// ── Empty events constant ───────────────────────────────────────────────

/** Shared empty-events object. Safe to reuse — all arrays are empty and never mutated. */
export const EMPTY_FRAME_EVENTS: FrameEvents = {
  deadUnits: [],
  conquestEvents: [],
  unitUpdates: [],
  playerUpdates: [],
  allianceFormed: [],
  allianceBroken: [],
  allianceExpired: [],
  embargoEvents: [],
  targetEvents: [],
  bonusEvents: [],
  nukeIncoming: [],
  emojis: [],
  displayMessages: [],
  wins: [],
  gamePaused: null,
};

// ── FrameEvents ─────────────────────────────────────────────────────────

/**
 * Everything that happened THIS frame. Accumulated state and derived data
 * live on FrameData directly — per-frame ephemeral events live here.
 *
 * Empty arrays when nothing happened. Producers must always populate every
 * field (no undefined — consumers shouldn't need null checks).
 */
export interface FrameEvents {
  // Rendering events
  readonly deadUnits: DeadUnitFx[];
  readonly conquestEvents: ConquestFx[];

  // Stats events
  readonly unitUpdates: UnitState[];
  readonly playerUpdates: PlayerState[];
  readonly allianceFormed: AllianceFormedEvent[];
  readonly allianceBroken: AllianceBrokenEvent[];
  readonly allianceExpired: AllianceExpiredEvent[];
  readonly embargoEvents: EmbargoEvent[];
  readonly targetEvents: TargetEvent[];
  readonly bonusEvents: BonusEvent[];
  readonly nukeIncoming: NukeIncomingEvent[];
  readonly emojis: EmojiEvent[];
  readonly displayMessages: DisplayMessageEvent[];
  readonly wins: WinEvent[];
  readonly gamePaused: boolean | null;
}
