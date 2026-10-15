/**
 * Types shared by the replay encoder and decoder.
 *
 * Entity records use the renderer's own PlayerState / PlayerStatic /
 * UnitState types (src/client/render/types), so decoded frames can go
 * straight to the renderer.
 */

import type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  UnitState,
} from "../../render/types";

/**
 * Format version, part of a stored replay's key (ReplayStore), so bump it
 * on any change to how frames or packed events (PackedEvents) are encoded.
 * Stored replays are also keyed by build, so this only matters for dev
 * builds, which all share "DEV".
 */
export const REPLAY_VERSION = 1;

/**
 * Frames per chunk. Each chunk starts with a keyframe, and keyframes are
 * most of a file. On a 26 minute, 25 player game, 100 gives a median seek
 * of 29 ms against 33 ms for 200, for a file about 19% bigger. Each file
 * stores its own interval, so changing this doesn't break stored replays.
 */
export const DEFAULT_KEYFRAME_INTERVAL = 100;

/**
 * gunzip. ReplayReader decodes synchronously, so an async one needs the
 * chunk loaded first (ReplayReader.load).
 */
export type InflateFn = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
export type GzipFn = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** A finished chunk, gzipped. */
export interface EncodedChunk {
  compressed: Uint8Array;
  frameCount: number;
}

/**
 * When a unit's grid motion plan arrived (`tick`) and when it starts
 * moving (`startTick`). The client gets a plan before it starts (a nuke's
 * launch delay, for example), and the nuke telegraph needs both.
 */
export interface ReplayMotionPlan {
  tick: number;
  unitId: number;
  startTick: number;
}

/**
 * Tiles hit by nukes on one tick (from packedNukeImpacts), split by
 * whether each is land after that tick. A nukeable map layer loses the
 * tiles of its own placement (WebGLFrameBuilder.syncNukeImpacts), and a
 * water nuke can turn land into water later, so this is decided here.
 */
export interface NukeImpactEvent {
  tick: number;
  land: number[];
  water: number[];
}

export enum RailroadEventKind {
  Destruction = 1,
  Construction = 2,
  Snap = 3,
}

export type RailroadEvent =
  | { tick: number; kind: RailroadEventKind.Destruction; id: number }
  | {
      tick: number;
      kind: RailroadEventKind.Construction;
      id: number;
      tiles: number[];
    }
  | {
      tick: number;
      kind: RailroadEventKind.Snap;
      originalId: number;
      newId1: number;
      newId2: number;
      tiles1: number[];
      tiles2: number[];
    };

export interface ConstructionStartEvent {
  unitId: number;
  startTick: number;
}

export interface DeadUnitEvent {
  tick: number;
  unitId: number;
  unitType: string;
  ownerSmallID: number;
  pos: number;
  reachedTarget: boolean;
}

/** The tick that ended the spawn phase, and the game's start tick. */
export interface SpawnPhaseEndEvent {
  tick: number;
  startTick: number;
}

/**
 * Misc per-tick updates, keyed by GameUpdateType name. The numeric `type`
 * field is stripped from each payload because enum values can change
 * between builds. The name is what counts.
 */
export type MiscUpdates = Record<string, unknown[]>;

/** Event lists that go with the frames. */
export interface ReplayEvents {
  nukeImpacts: NukeImpactEvent[];
  railroadEvents: RailroadEvent[];
  motionPlans: ReplayMotionPlan[];
  constructionStarts: ConstructionStartEvent[];
  deadUnitEvents: DeadUnitEvent[];
  /** Null if the game never left the spawn phase. */
  spawnPhaseEnd: SpawnPhaseEndEvent | null;
}

/** The ReplayEvents fields that are lists (they only ever grow). */
export const EVENT_LISTS = [
  "nukeImpacts",
  "railroadEvents",
  "motionPlans",
  "constructionStarts",
  "deadUnitEvents",
] as const satisfies readonly (keyof ReplayEvents)[];

/** The header fields that are fixed from the start of a game. */
export interface ReplayBase {
  keyframeInterval: number;
  mapWidth: number;
  mapHeight: number;
  /** The map's land tiles before any water nukes. */
  numLandTiles: number;
  gameStartInfo: unknown;
}

export interface ReplayHeader extends ReplayBase, ReplayEvents {
  /** Grows when ReplayReader.append adds frames. */
  totalFrames: number;
  players: PlayerStatic[];
  unitTypes: string[];
}

/**
 * What a game that's still being processed has gained since the last
 * append (StreamingEncoder.takeAppend). A reader made from the game's
 * ReplayBase and every append holds the whole replay.
 */
export interface ReplayAppend {
  chunks: EncodedChunk[];
  players: PlayerStatic[];
  unitTypes: string[];
  events: ReplayEvents;
}

/**
 * A whole replay: the base and everything appended to it, merged into one
 * append. This is what ReplayStore keeps (with the nuke impacts and dead
 * units packed, see PackedEvents) and what ReplayPlayback opens.
 */
export interface ReplayData {
  base: ReplayBase;
  append: ReplayAppend;
}

/** Full game state at one frame, as rebuilt by ReplayReader. */
export interface ReplayFrame {
  frame: number;
  tick: number;
  tileState: Uint16Array;
  /**
   * Tiles this frame changed (unordered), null after a seek. Stepping onto
   * a keyframe lists the tiles that differ from the frame before.
   */
  changedTiles: number[] | null;
  /** Tiles with fallout (GameMap.numTilesWithFallout). */
  falloutTiles: number;
  players: ReadonlyMap<number, PlayerState>;
  units: ReadonlyMap<number, UnitState>;
  names: ReadonlyMap<string, NameEntry>;
  /**
   * Terrain bytes for tiles whose terrain changed during the game (water
   * nukes). Every other tile has the map's original byte. A tile can stay
   * in here after changing back to its original byte.
   */
  terrain: ReadonlyMap<number, number>;
  /** Tiles whose terrain changed, null after a seek or a keyframe. */
  changedTerrain: number[] | null;
  miscUpdates: MiscUpdates | null;
}
