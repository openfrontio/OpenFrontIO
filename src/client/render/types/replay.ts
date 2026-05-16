import type {
  ConquestFx,
  DeadUnitFx,
  NameEntry,
  PlayerState,
  PlayerStatic,
  RendererConfig,
  TilePair,
  UnitState,
} from "./renderer";

/** Chunk index entry — one per chunk in the file */
export interface ChunkIndexEntry {
  compressedOffset: number;
  compressedSize: number;
  decompressedSize: number;
  frameCount: number;
}

/** Subset of header available after streaming preamble (before full file download). */
export interface StreamableReplayInfo extends RendererConfig {
  totalFrames: number;
  keyframeInterval: number;
  numLandTiles: number;
  gameStartInfo: unknown;
  chunks: ChunkIndexEntry[];
}

/** Parsed v6 file header + dictionaries + chunk index + trailer sections */
export interface ReplayHeader extends StreamableReplayInfo {
  magic: number;
  version: number;
  gameID: string;
  totalFrames: number;
  keyframeInterval: number;
  numLandTiles: number;
  processedAt: number;
  processingDurationMs: number;
  gameStartInfo: unknown;
  players: PlayerStatic[];
  /** Chunk index — per-chunk offsets and sizes */
  chunks: ChunkIndexEntry[];
  /** Nuke detonation events — top-level index for seek-time heat reconstruction */
  nukeEvents: Array<{ tick: number; tiles: number[] }>;
  /** Railroad events — top-level index for seek-time railroad reconstruction */
  railroadEvents: Array<{ tick: number; type: number; data: unknown }>;
  /** Motion plan events — top-level index for plan-driven unit positions and trails */
  motionPlanEvents: MotionPlanRecord[];
  /** Construction start events — top-level index for seek-time construction progress */
  constructionStarts: Array<{ unitId: number; startTick: number }>;
  /** Conquest events — top-level index for seek-time gold popup + sword sprite */
  conquestEvents: Array<{ tick: number; x: number; y: number; gold: number }>;
  /** Dead unit events — top-level index for seek-time explosion/death FX */
  deadUnitEvents: Array<{
    tick: number;
    unitType: string;
    pos: number;
    reachedTarget: boolean;
  }>;
  /** Player elimination events — tick when each player's isAlive transitioned to false */
  eliminationEvents: Array<{ tick: number; smallID: number }>;
}

/** Raw decoded v4 keyframe data — tile data is a raw Uint16Array blob */
export interface RawKeyframe {
  type: 0;
  tick: number;
  /** Raw tile blob: Uint16Array[mapWidth x mapHeight]. Direct GPU upload. */
  tileBlob: Uint16Array;
  players: Map<number, PlayerState>;
  units: Map<number, UnitState>;
  names: Map<string, NameEntry>;
  miscUpdates: Record<string, unknown[]> | null;
}

/** Raw decoded delta frame data */
export interface RawDelta {
  type: 1;
  tick: number;
  tiles: TilePair[];
  playerDeltas: Map<number, PlayerState>; // new or changed players (full state after applying delta)
  playersRemoved: number[];
  unitDeltas: Map<number, UnitState>;
  unitsRemoved: number[];
  nameChanges: Map<string, NameEntry>;
  miscUpdates: Record<string, unknown[]> | null;
}

export type RawFrame = RawKeyframe | RawDelta;

/** Full accumulated game state at a given tick */
export interface FrameSnapshot {
  tick: number;
  players: Map<number, PlayerState>;
  units: Map<number, UnitState>;
  names: Map<string, NameEntry>;
  /** Tiles changed in this frame only (for incremental rendering). null = full upload needed. */
  changedTiles: TilePair[] | null;
  /** Units that died this frame (FX-only data). Empty on keyframes. */
  deadUnits: DeadUnitFx[];
  /** Conquest events active at this tick (from global index). */
  conquestEvents: ConquestFx[];
  /** Per-frame misc updates (alliances, donations, trades, etc.). null = none. */
  miscUpdates: Record<string, unknown[]> | null;
}

/**
 * Inflate function type — platform provides its implementation.
 * Node: zlib.inflateSync, Browser: pako.inflate
 */
export type InflateFn = (data: Uint8Array) => Uint8Array;

/**
 * Gzip function type — platform provides its implementation.
 * Node: zlib.gzipSync, Browser: pako.gzip
 */
export type GzipFn = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

// ---------------------------------------------------------------------------
// Motion plan records — stored as a file-level index for plan-driven units
// (transport ships, trade ships, trains).
// ---------------------------------------------------------------------------

export interface GridPlanRecord {
  kind: "grid";
  unitId: number;
  planId: number;
  startTick: number;
  ticksPerStep: number;
  path: Uint32Array;
}

export interface TrainPlanRecord {
  kind: "train";
  engineUnitId: number;
  carUnitIds: Uint32Array;
  planId: number;
  startTick: number;
  speed: number;
  spacing: number;
  path: Uint32Array;
}

export type MotionPlanRecord = GridPlanRecord | TrainPlanRecord;
