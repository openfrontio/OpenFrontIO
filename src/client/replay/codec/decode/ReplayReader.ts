/**
 * ReplayReader rebuilds the game state at any frame.
 *
 * seek(frame) applies the keyframe at the start of the frame's chunk and
 * then the deltas up to the target. When moving forward inside the same
 * chunk it only applies the deltas after the current frame. next() moves
 * one frame forward. The maps in a returned ReplayFrame are reused and
 * change on the next call, but the PlayerState / UnitState objects inside
 * them are never mutated (deltas make copies), so it's safe to hold on to
 * those.
 *
 * A reader starts from a game's ReplayBase with no frames. append() adds
 * what the game gained (StreamingEncoder.takeAppend): more frames, and the
 * players, unit types and events that come with them.
 *
 * Decoding is synchronous, gunzip in a browser isn't. seek() and next()
 * need their chunk loaded (load(chunkOf(frame))) unless the reader's
 * inflate function is synchronous, as it is in tests and Node.
 */

import { FALLOUT_BIT } from "../../../render/gl/utils/TileCodec";
import type { NameEntry, PlayerState, UnitState } from "../../../render/types";
import { BinaryReader } from "../BinaryReader";
import {
  FRAME_DELTA,
  FRAME_KEYFRAME,
  SEC_MISC,
  SEC_NAMES,
  SEC_PLAYERS,
  SEC_TERRAIN,
  SEC_TILES,
  SEC_UNITS,
  SEC_UNITS_REMOVED,
} from "../encode/FrameEncoder";
import {
  PLAYER_FIELDS,
  UNIT_FIELDS,
  readEntityDelta,
  readEntityFull,
  type DecodeCtx,
} from "../EntitySchema";
import {
  EVENT_LISTS,
  type EncodedChunk,
  type InflateFn,
  type MiscUpdates,
  type ReplayAppend,
  type ReplayBase,
  type ReplayData,
  type ReplayFrame,
  type ReplayHeader,
} from "../ReplayTypes";

/** Inflated chunks kept around, least recently used dropped first. */
const MAX_CACHED_CHUNKS = 3;

interface Chunk {
  bytes: Uint8Array;
  /** Absolute byte offset of each frame within `bytes`. */
  frameOffsets: number[];
}

export class ReplayReader {
  readonly header: ReplayHeader;
  private readonly ctx: DecodeCtx;
  private readonly constructionStart = new Map<number, number>();
  /** Inflated chunks, in the order they were last used. */
  private readonly cache = new Map<number, Chunk>();
  private readonly loading = new Map<number, Promise<void>>();
  private readonly _chunks: EncodedChunk[] = [];

  private readonly tileState: Uint16Array;
  private falloutTiles = 0;
  private players = new Map<number, PlayerState>();
  private units = new Map<number, UnitState>();
  private names = new Map<string, NameEntry>();
  private terrain = new Map<number, number>();
  private frame = -1;
  private tick = -1;

  constructor(
    private readonly base: ReplayBase,
    private readonly inflate: InflateFn,
  ) {
    this.header = {
      ...base,
      totalFrames: 0,
      players: [],
      unitTypes: [],
      nukeImpacts: [],
      railroadEvents: [],
      motionPlans: [],
      constructionStarts: [],
      deadUnitEvents: [],
      spawnPhaseEnd: null,
    };
    this.ctx = { unitTypes: this.header.unitTypes };
    this.tileState = new Uint16Array(base.mapWidth * base.mapHeight);
  }

  /** Adds frames past the current end, and everything that comes with them. */
  append(more: ReplayAppend): void {
    const h = this.header;
    for (const c of more.chunks) {
      this._chunks.push(c);
      h.totalFrames += c.frameCount;
    }
    h.players.push(...more.players);
    // this.ctx reads this same array.
    h.unitTypes.push(...more.unitTypes);
    for (const key of EVENT_LISTS) {
      (h[key] as unknown[]).push(...more.events[key]);
    }
    h.spawnPhaseEnd ??= more.events.spawnPhaseEnd;
    for (const e of more.events.constructionStarts) {
      this.constructionStart.set(e.unitId, e.startTick);
    }
  }

  /** The whole replay so far, to keep it (ReplayStore). */
  data(): ReplayData {
    const h = this.header;
    return {
      base: this.base,
      append: {
        chunks: this._chunks.slice(),
        players: h.players.slice(),
        unitTypes: h.unitTypes.slice(),
        events: {
          nukeImpacts: h.nukeImpacts.slice(),
          railroadEvents: h.railroadEvents.slice(),
          motionPlans: h.motionPlans.slice(),
          constructionStarts: h.constructionStarts.slice(),
          deadUnitEvents: h.deadUnitEvents.slice(),
          spawnPhaseEnd: h.spawnPhaseEnd,
        },
      },
    };
  }

  /** The chunk a frame is in. */
  chunkOf(frame: number): number {
    return Math.floor(frame / this.header.keyframeInterval);
  }

  /**
   * Inflate a chunk so seek() and next() can use it. Resolves at once for
   * a chunk that's loaded, or past the end.
   */
  load(index: number): Promise<void> {
    if (this.cache.has(index)) return Promise.resolve();
    const compressed = this._chunks[index]?.compressed;
    if (compressed === undefined) return Promise.resolve();
    let p = this.loading.get(index);
    if (p === undefined) {
      p = Promise.resolve(this.inflate(compressed))
        .then((bytes) => {
          if (!this.cache.has(index)) this.cache.set(index, parseChunk(bytes));
        })
        .finally(() => this.loading.delete(index));
      this.loading.set(index, p);
    }
    return p;
  }

  seek(target: number): ReplayFrame {
    const total = this.header.totalFrames;
    if (target < 0 || target >= total) {
      throw new RangeError(`frame ${target} out of range [0, ${total})`);
    }
    const chunkIndex = this.chunkOf(target);
    const chunk = this.chunk(chunkIndex);
    const first = chunkIndex * this.header.keyframeInterval;
    let misc: MiscUpdates | null = null;
    let f = this.frame - first;
    if (f < 0 || this.frame >= target) {
      misc = this.applyKeyframe(chunk, null);
      f = 0;
    }
    while (f < target - first) misc = this.applyDelta(chunk, ++f).misc;
    this.frame = target;
    return this.snapshot(null, null, misc);
  }

  /** Advance one frame; null at the end of the replay. */
  next(): ReplayFrame | null {
    const target = this.frame + 1;
    if (target >= this.header.totalFrames) return null;
    if (this.frame < 0) return this.seek(target);
    const chunk = this.chunk(this.chunkOf(target));
    const inChunk = target % this.header.keyframeInterval;
    if (inChunk === 0) {
      // Stepping onto a keyframe: list the tiles it changed, so the
      // renderer doesn't re-upload the whole map every chunk.
      const changedTiles: number[] = [];
      const misc = this.applyKeyframe(chunk, changedTiles);
      this.frame = target;
      return this.snapshot(changedTiles, null, misc);
    }
    const { changedTiles, changedTerrain, misc } = this.applyDelta(
      chunk,
      inChunk,
    );
    this.frame = target;
    return this.snapshot(changedTiles, changedTerrain, misc);
  }

  private snapshot(
    changedTiles: number[] | null,
    changedTerrain: number[] | null,
    misc: MiscUpdates | null,
  ): ReplayFrame {
    return {
      frame: this.frame,
      tick: this.tick,
      tileState: this.tileState,
      changedTiles,
      falloutTiles: this.falloutTiles,
      players: this.players,
      units: this.units,
      names: this.names,
      terrain: this.terrain,
      changedTerrain,
      miscUpdates: misc,
    };
  }

  /** A loaded chunk, marked most recently used. */
  private chunk(index: number): Chunk {
    let chunk = this.cache.get(index);
    if (chunk === undefined) {
      const compressed = this._chunks[index]?.compressed;
      if (compressed === undefined) throw new RangeError(`no chunk ${index}`);
      const bytes = this.inflate(compressed);
      if (bytes instanceof Promise) {
        bytes.catch(() => {});
        throw new Error(`chunk ${index} isn't loaded, call load() first`);
      }
      chunk = parseChunk(bytes);
    }
    this.cache.delete(index);
    this.cache.set(index, chunk);
    // Trimmed on use rather than on load, so a chunk that was just loaded
    // is still here when the decode that needs it runs.
    for (const old of this.cache.keys()) {
      if (this.cache.size <= MAX_CACHED_CHUNKS) break;
      this.cache.delete(old);
    }
    return chunk;
  }

  private reader(chunk: Chunk, frameInChunk: number): BinaryReader {
    const r = new BinaryReader(chunk.bytes);
    r.seek(chunk.frameOffsets[frameInChunk]);
    return r;
  }

  /** `changed` collects the tiles the keyframe changed, if given. */
  private applyKeyframe(
    chunk: Chunk,
    changed: number[] | null,
  ): MiscUpdates | null {
    const r = this.reader(chunk, 0);
    const type = r.readU8();
    if (type !== FRAME_KEYFRAME)
      throw new Error(`expected keyframe, got ${type}`);
    this.tick = r.readU32();

    this.falloutTiles = readTileRuns(r, this.tileState, changed);

    this.players = new Map();
    const playerCount = r.readU16();
    for (let i = 0; i < playerCount; i++) {
      const smallID = r.readU16();
      const p = { smallID } as PlayerState;
      this.players.set(smallID, readEntityFull(r, PLAYER_FIELDS, p, this.ctx));
    }

    this.units = new Map();
    const unitCount = r.readU32();
    for (let i = 0; i < unitCount; i++) this.readNewUnit(r);

    this.names = new Map();
    this.readNames(r);

    const misc = readMisc(r);
    this.terrain = new Map();
    this.readTerrain(r);
    return misc;
  }

  private applyDelta(
    chunk: Chunk,
    frameInChunk: number,
  ): {
    changedTiles: number[];
    changedTerrain: number[];
    misc: MiscUpdates | null;
  } {
    const r = this.reader(chunk, frameInChunk);
    const type = r.readU8();
    if (type !== FRAME_DELTA) throw new Error(`expected delta, got ${type}`);
    this.tick = r.readU32();
    const mask = r.readU8();

    const changedTiles: number[] = [];
    if (mask & SEC_TILES) {
      const groups = r.readVarUint();
      for (let g = 0; g < groups; g++) {
        const state = r.readU16();
        const count = r.readVarUint();
        let ref = 0;
        for (let i = 0; i < count; i++) {
          ref += r.readVarUint();
          if (this.tileState[ref] & FALLOUT_BIT) this.falloutTiles--;
          if (state & FALLOUT_BIT) this.falloutTiles++;
          this.tileState[ref] = state;
          changedTiles.push(ref);
        }
      }
    }

    if (mask & SEC_PLAYERS) {
      const newCount = r.readU16();
      for (let i = 0; i < newCount; i++) {
        const smallID = r.readU16();
        const p = { smallID } as PlayerState;
        this.players.set(
          smallID,
          readEntityFull(r, PLAYER_FIELDS, p, this.ctx),
        );
      }
      const changedCount = r.readVarUint();
      let smallID = 0;
      for (let i = 0; i < changedCount; i++) {
        smallID += r.readVarUint();
        const prev = this.players.get(smallID);
        if (prev === undefined) {
          throw new Error(
            `delta for unknown player ${smallID} at ${this.tick}`,
          );
        }
        this.players.set(
          smallID,
          readEntityDelta(r, PLAYER_FIELDS, { ...prev }, this.ctx),
        );
      }
    }

    if (mask & SEC_UNITS) {
      const newCount = r.readU32();
      for (let i = 0; i < newCount; i++) this.readNewUnit(r);
      const changedCount = r.readVarUint();
      let id = 0;
      for (let i = 0; i < changedCount; i++) {
        id += r.readVarUint();
        const prev = this.units.get(id);
        if (prev === undefined) {
          throw new Error(`delta for unknown unit ${id} at ${this.tick}`);
        }
        const u = readEntityDelta(r, UNIT_FIELDS, { ...prev }, this.ctx);
        u.constructionStartTick = this.constructionStartOf(u);
        this.units.set(id, u);
      }
    }

    if (mask & SEC_NAMES) this.readNames(r);
    const misc = mask & SEC_MISC ? readMisc(r) : null;

    if (mask & SEC_UNITS_REMOVED) {
      const count = r.readVarUint();
      let id = 0;
      for (let i = 0; i < count; i++) {
        id += r.readVarUint();
        this.units.delete(id);
      }
    }

    const changedTerrain = mask & SEC_TERRAIN ? this.readTerrain(r) : [];

    return { changedTiles, changedTerrain, misc };
  }

  /** Terrain list (see FrameEncoder) into `terrain`; returns its refs. */
  private readTerrain(r: BinaryReader): number[] {
    const refs: number[] = new Array(r.readVarUint());
    let ref = 0;
    for (let i = 0; i < refs.length; i++) {
      ref += r.readVarUint();
      refs[i] = ref;
    }
    for (const ref of refs) this.terrain.set(ref, r.readU8());
    return refs;
  }

  private readNewUnit(r: BinaryReader): void {
    const id = r.readU32();
    const u = { id } as UnitState;
    readEntityFull(r, UNIT_FIELDS, u, this.ctx);
    u.constructionStartTick = this.constructionStartOf(u);
    this.units.set(id, u);
  }

  private constructionStartOf(u: UnitState): number | null {
    return u.underConstruction
      ? (this.constructionStart.get(u.id) ?? null)
      : null;
  }

  private readNames(r: BinaryReader): void {
    const count = r.readU16();
    for (let i = 0; i < count; i++) {
      const playerID = r.readShortString();
      const x = r.readU16();
      const y = r.readU16();
      const size = r.readU16();
      this.names.set(playerID, { playerID, x, y, size });
    }
  }
}

/** Parse a chunk's frame offset table (see StreamingEncoder.closeChunk). */
function parseChunk(bytes: Uint8Array): Chunk {
  const r = new BinaryReader(bytes);
  const count = r.readU16();
  const base = 2 + count * 4;
  const frameOffsets: number[] = [];
  for (let i = 0; i < count; i++) frameOffsets.push(base + r.readU32());
  return { bytes, frameOffsets };
}

/**
 * Whole-map tile state from runs (see FrameEncoder), into `tiles`. Pushes
 * the tiles whose state changed to `changed`, if given. Returns the number
 * of tiles with fallout.
 */
function readTileRuns(
  r: BinaryReader,
  tiles: Uint16Array,
  changed: number[] | null,
): number {
  const runs = r.readVarUint();
  const values = new Uint16Array(runs);
  for (let i = 0; i < runs; i++) values[i] = r.readU16();
  let fallout = 0;
  let at = 0;
  for (let i = 0; i < runs; i++) {
    const v = values[i];
    const end = at + r.readVarUint();
    if (end > tiles.length) {
      throw new RangeError(
        `tile runs overrun the map (${end} > ${tiles.length})`,
      );
    }
    if (v & FALLOUT_BIT) fallout += end - at;
    if (changed === null) {
      tiles.fill(v, at, end);
    } else {
      for (let ref = at; ref < end; ref++) {
        if (tiles[ref] !== v) {
          tiles[ref] = v;
          changed.push(ref);
        }
      }
    }
    at = end;
  }
  if (at !== tiles.length) {
    throw new RangeError(`tile runs cover ${at} of ${tiles.length} tiles`);
  }
  return fallout;
}

function readMisc(r: BinaryReader): MiscUpdates | null {
  const json = r.readLongString();
  return json === "" ? null : (JSON.parse(json) as MiscUpdates);
}
