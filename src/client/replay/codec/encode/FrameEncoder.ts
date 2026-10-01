/**
 * Encodes normalized frames as keyframes (the full state) or deltas (what
 * changed since the previous frame). Every chunk starts with a keyframe,
 * so any frame can be rebuilt from its own chunk.
 *
 * Keyframe: u8 0, u32 tick, tile runs, players, units, names, misc,
 *           terrain list (every tile whose terrain differs from the map's)
 * Delta:    u8 1, u32 tick, u8 sectionMask, then the sections present
 *
 * Most of the size is per-tick churn (moving units, captured tiles), so
 * counts, ids and positions are varints of small differences. gzip can't
 * see that redundancy in fixed-width fields. On a 30 minute, 530 player
 * game (2100x1840 map) this took the file from 138 MB to 53 MB, and moving
 * units alone from 72 MB to about 6 MB.
 *
 * Tile runs:    varuint runCount, u16 × runCount values, varuint × runCount
 *               lengths (row-major over the whole map; values and lengths
 *               are kept apart so each compresses on its own)
 * Tile changes: varuint groupCount × (u16 state, varuint count,
 *               varuint × count ascending ref gaps). Most of a tick's
 *               captures share the same new state
 * Changed entities: varuint count × (varuint id gap, ascending, then the
 *               entity delta)
 * Removed units: varuint count × varuint id gap, ascending
 * Terrain list: varuint count, varuint × count ascending ref gaps, u8 ×
 *               count terrain bytes. Terrain changes when water nukes turn
 *               land into water (and reshape the coast around it); tile
 *               updates carry the terrain byte in bits 16-23.
 */

import type { NameEntry, PlayerState, UnitState } from "../../../render/types";
import { BinaryWriter } from "../BinaryWriter";
import {
  PLAYER_FIELDS,
  UNIT_FIELDS,
  diffFields,
  writeEntityDelta,
  writeEntityFull,
  type EncodeCtx,
} from "../EntitySchema";
import type { NormalizedFrame } from "../FrameNormalizer";
import type { MiscUpdates } from "../ReplayTypes";

export const FRAME_KEYFRAME = 0;
export const FRAME_DELTA = 1;

export const SEC_TILES = 1 << 0;
export const SEC_PLAYERS = 1 << 1;
export const SEC_UNITS = 1 << 2;
export const SEC_NAMES = 1 << 3;
export const SEC_MISC = 1 << 4;
export const SEC_UNITS_REMOVED = 1 << 5;
export const SEC_TERRAIN = 1 << 6;

export class FrameEncoder {
  /** Tile state for the whole game so far. */
  readonly tileState: Uint16Array;
  /** Player state as last encoded in the current chunk. */
  private prevPlayers = new Map<number, PlayerState>();
  /** Names as last encoded in the current chunk. */
  private prevNames = new Map<string, NameEntry>();

  /** Current terrain byte per tile. */
  private readonly terrain: Uint8Array;
  /** Tiles whose terrain differs from the map's own, and their bytes. */
  private readonly terrainOverrides = new Map<number, number>();

  /** `baseTerrain`: the map's terrain bytes before the first tick. */
  constructor(
    mapWidth: number,
    mapHeight: number,
    private readonly baseTerrain: Uint8Array,
  ) {
    if (baseTerrain.length !== mapWidth * mapHeight) {
      throw new Error(
        `terrain has ${baseTerrain.length} tiles, the map ${mapWidth * mapHeight}`,
      );
    }
    this.tileState = new Uint16Array(mapWidth * mapHeight);
    this.terrain = baseTerrain.slice();
  }

  /** Whether a tile is land now (GameMapImpl.IS_LAND_BIT). */
  isLand(ref: number): boolean {
    return (this.terrain[ref] & (1 << 7)) !== 0;
  }

  encodeKeyframe(
    w: BinaryWriter,
    frame: NormalizedFrame,
    ctx: EncodeCtx,
  ): void {
    this.applyTiles(frame.tiles);
    this.applyTerrain(frame.tiles);

    w.writeU8(FRAME_KEYFRAME);
    w.writeU32(frame.tick);
    writeTileRuns(w, this.tileState);

    this.prevPlayers = new Map(frame.players);
    w.writeU16(frame.players.size);
    for (const [smallID, p] of frame.players) {
      w.writeU16(smallID);
      writeEntityFull(w, PLAYER_FIELDS, p, ctx);
    }

    w.writeU32(frame.activeUnits.size);
    for (const [id, u] of frame.activeUnits) {
      w.writeU32(id);
      writeEntityFull(w, UNIT_FIELDS, u, ctx);
    }

    this.prevNames = new Map(frame.names);
    writeNames(w, [...frame.names.values()]);

    writeMisc(w, frame.misc);

    writeTerrain(w, [...this.terrainOverrides.keys()], this.terrain);
  }

  encodeDelta(w: BinaryWriter, frame: NormalizedFrame, ctx: EncodeCtx): void {
    const tiles = this.applyTiles(frame.tiles);
    const terrain = this.applyTerrain(frame.tiles);

    const newPlayers: [number, PlayerState][] = [];
    const changedPlayers: [number, PlayerState, PlayerState, number][] = [];
    for (const [smallID, curr] of frame.players) {
      const prev = this.prevPlayers.get(smallID);
      if (prev === curr) continue;
      if (prev === undefined) {
        newPlayers.push([smallID, curr]);
      } else {
        const mask = diffFields(PLAYER_FIELDS, prev, curr);
        if (mask !== 0) changedPlayers.push([smallID, curr, prev, mask]);
      }
      this.prevPlayers.set(smallID, curr);
    }

    const newUnits: UnitState[] = [];
    const changedUnits: [UnitState, UnitState, number][] = [];
    const removedUnits: number[] = [];
    for (const u of frame.units) {
      const prev = frame.previousUnits.get(u.id);
      if (!u.isActive) {
        if (prev !== undefined) removedUnits.push(u.id);
      } else if (prev === undefined) {
        newUnits.push(u);
      } else {
        const mask = diffFields(UNIT_FIELDS, prev, u);
        if (mask !== 0) changedUnits.push([u, prev, mask]);
      }
    }

    const nameChanges: NameEntry[] = [];
    if (frame.namesChanged) {
      for (const [playerID, n] of frame.names) {
        const prev = this.prevNames.get(playerID);
        if (prev !== n) {
          nameChanges.push(n);
          this.prevNames.set(playerID, n);
        }
      }
    }

    let mask = 0;
    if (tiles.length > 0) mask |= SEC_TILES;
    if (newPlayers.length + changedPlayers.length > 0) mask |= SEC_PLAYERS;
    if (newUnits.length + changedUnits.length > 0) mask |= SEC_UNITS;
    if (nameChanges.length > 0) mask |= SEC_NAMES;
    if (frame.misc !== null) mask |= SEC_MISC;
    if (removedUnits.length > 0) mask |= SEC_UNITS_REMOVED;
    if (terrain.length > 0) mask |= SEC_TERRAIN;

    w.writeU8(FRAME_DELTA);
    w.writeU32(frame.tick);
    w.writeU8(mask);

    if (mask & SEC_TILES) writeTileChanges(w, tiles, this.tileState);

    if (mask & SEC_PLAYERS) {
      w.writeU16(newPlayers.length);
      for (const [smallID, p] of newPlayers) {
        w.writeU16(smallID);
        writeEntityFull(w, PLAYER_FIELDS, p, ctx);
      }
      changedPlayers.sort((a, b) => a[0] - b[0]);
      w.writeVarUint(changedPlayers.length);
      let prevID = 0;
      for (const [smallID, curr, prev, m] of changedPlayers) {
        w.writeVarUint(smallID - prevID);
        prevID = smallID;
        writeEntityDelta(w, PLAYER_FIELDS, m, curr, prev, ctx);
      }
    }

    if (mask & SEC_UNITS) {
      w.writeU32(newUnits.length);
      for (const u of newUnits) {
        w.writeU32(u.id);
        writeEntityFull(w, UNIT_FIELDS, u, ctx);
      }
      changedUnits.sort((a, b) => a[0].id - b[0].id);
      w.writeVarUint(changedUnits.length);
      let prevID = 0;
      for (const [curr, prev, m] of changedUnits) {
        w.writeVarUint(curr.id - prevID);
        prevID = curr.id;
        writeEntityDelta(w, UNIT_FIELDS, m, curr, prev, ctx);
      }
    }

    if (mask & SEC_NAMES) writeNames(w, nameChanges);
    if (mask & SEC_MISC) writeMisc(w, frame.misc);

    if (mask & SEC_UNITS_REMOVED) {
      removedUnits.sort((a, b) => a - b);
      w.writeVarUint(removedUnits.length);
      let prevID = 0;
      for (const id of removedUnits) {
        w.writeVarUint(id - prevID);
        prevID = id;
      }
    }

    if (mask & SEC_TERRAIN) writeTerrain(w, terrain, this.terrain);
  }

  /** Fold the terrain bytes of `[ref, state]` pairs; returns changed refs. */
  private applyTerrain(packed: Uint32Array): number[] {
    const changed: number[] = [];
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const ref = packed[i];
      const byte = (packed[i + 1] >>> 16) & 0xff;
      if (this.terrain[ref] === byte) continue;
      this.terrain[ref] = byte;
      if (byte === this.baseTerrain[ref]) this.terrainOverrides.delete(ref);
      else this.terrainOverrides.set(ref, byte);
      changed.push(ref);
    }
    return changed;
  }

  /** Fold `[ref, state]` pairs into tileState; returns the unique refs. */
  private applyTiles(packed: Uint32Array): number[] {
    const refs = new Set<number>();
    for (let i = 0; i + 1 < packed.length; i += 2) {
      this.tileState[packed[i]] = packed[i + 1] & 0xffff;
      refs.add(packed[i]);
    }
    return [...refs];
  }
}

/** Whole-map tile state as runs (see the file comment). */
function writeTileRuns(w: BinaryWriter, tileState: Uint16Array): void {
  const values: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < tileState.length; ) {
    const v = tileState[i];
    let j = i + 1;
    while (j < tileState.length && tileState[j] === v) j++;
    values.push(v);
    lengths.push(j - i);
    i = j;
  }
  w.writeVarUint(values.length);
  for (const v of values) w.writeU16(v);
  for (const n of lengths) w.writeVarUint(n);
}

/** Changed tiles grouped by new state (see the file comment). */
function writeTileChanges(
  w: BinaryWriter,
  refs: number[],
  tileState: Uint16Array,
): void {
  const groups = new Map<number, number[]>();
  for (const ref of refs) {
    const state = tileState[ref];
    const group = groups.get(state);
    if (group === undefined) groups.set(state, [ref]);
    else group.push(ref);
  }
  w.writeVarUint(groups.size);
  for (const [state, group] of groups) {
    group.sort((a, b) => a - b);
    w.writeU16(state);
    w.writeVarUint(group.length);
    let prev = 0;
    for (const ref of group) {
      w.writeVarUint(ref - prev);
      prev = ref;
    }
  }
}

/** Terrain list (see the file comment): refs ascending, then their bytes. */
function writeTerrain(
  w: BinaryWriter,
  refs: number[],
  terrain: Uint8Array,
): void {
  refs.sort((a, b) => a - b);
  w.writeVarUint(refs.length);
  let prev = 0;
  for (const ref of refs) {
    w.writeVarUint(ref - prev);
    prev = ref;
  }
  for (const ref of refs) w.writeU8(terrain[ref]);
}

function writeNames(w: BinaryWriter, names: NameEntry[]): void {
  w.writeU16(names.length);
  for (const n of names) {
    w.writeShortString(n.playerID);
    w.writeU16(n.x);
    w.writeU16(n.y);
    w.writeU16(n.size);
  }
}

function writeMisc(w: BinaryWriter, misc: MiscUpdates | null): void {
  w.writeLongString(misc === null ? "" : JSON.stringify(misc, jsonReplacer));
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Set) return [...value];
  return value;
}
