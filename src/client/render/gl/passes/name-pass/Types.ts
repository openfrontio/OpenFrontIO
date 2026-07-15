/**
 * Shared types and constants for the NamePass subsystem.
 */

// ---------------------------------------------------------------------------
// BMFont JSON types
// ---------------------------------------------------------------------------

export interface BMChar {
  id: number;
  char: string;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  x: number;
  y: number;
  page: number;
}

export interface BMKerning {
  first: number;
  second: number;
  amount: number;
}

export interface ParsedAtlas {
  fontSize: number;
  base: number;
  scaleW: number;
  scaleH: number;
  distanceRange: number;
  chars: BMChar[];
  kernings: BMKerning[];
}

// ---------------------------------------------------------------------------
// Per-player CPU-side state
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  index: number;
  playerID: string;
  static: import("../../../types").PlayerStatic;

  srcX: number;
  srcY: number;
  srcScale: number;
  tgtX: number;
  tgtY: number;
  tgtScale: number;
  startTime: number;

  alive: boolean;
  nameLen: number;
  troopLen: number;
  lastTroopStr: string;
  /** Last 500ms bucket this slot's troop string was refreshed in (staggered per slot). */
  lastTroopBucket: number;
  /** URL identifying which flag this player wants (dedup key). undefined = none. */
  flagUrl: string | undefined;
  /** Layer index in FlagAtlasArray, or -1 if not loaded yet / no flag. */
  flagLayerIdx: number;
  emojiAtlasIdx: number;
  nameHalfWidth: number;

  // Status flags (individual booleans, written as 1.0/0.0 to GPU)
  crown: boolean;
  traitor: boolean;
  disconnected: boolean;
  alliance: boolean;
  allianceReq: boolean;
  target: boolean;
  embargo: boolean;
  nukeActive: boolean;
  nukeTargetsMe: boolean;
  inDoomsdayClock: boolean;
  doomsdayClockDraining: boolean;
  doomsdayClockWarnProgress: number;
  traitorRemainingTicks: number;
  allianceFraction: number;
  allianceRemainingTicks: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max char ID in the atlas (Latin Extended-A goes to 383). */
export const CHAR_RANGE = 384;

/** Max characters per text line (name or troop count). */
export const MAX_CHARS = 32;

/** Lines per player: 0 = name, 1 = troop count. */
export const LINES_PER_PLAYER = 2;
