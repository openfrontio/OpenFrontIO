/**
 * The two big event lists in binary, for keeping a replay (ReplayStore
 * gzips the result). Nuke impacts list every tile in a blast, and a long
 * game has thousands of dead units: as plain objects they were about a
 * quarter of a stored replay.
 *
 * Nuke impacts: varuint count × (varuint tick, land tiles, water tiles),
 *   each tile list a varuint count and ascending varuint gaps (a blast is
 *   a disc, so the gaps are mostly 1).
 * Dead units: varuint count × (varuint tick, varuint unitId, short string
 *   unitType, varuint ownerSmallID, varuint pos, u8 reachedTarget).
 *
 * Tile lists come back sorted. Their order never mattered.
 */

import { BinaryReader } from "./BinaryReader";
import { BinaryWriter } from "./BinaryWriter";
import type { ReplayEvents } from "./ReplayTypes";

export type PackedEventLists = Pick<
  ReplayEvents,
  "nukeImpacts" | "deadUnitEvents"
>;

export function packEvents(events: PackedEventLists): Uint8Array {
  const w = new BinaryWriter(64 * 1024);
  w.writeVarUint(events.nukeImpacts.length);
  for (const e of events.nukeImpacts) {
    w.writeVarUint(e.tick);
    writeTiles(w, e.land);
    writeTiles(w, e.water);
  }
  w.writeVarUint(events.deadUnitEvents.length);
  for (const d of events.deadUnitEvents) {
    w.writeVarUint(d.tick);
    w.writeVarUint(d.unitId);
    w.writeShortString(d.unitType);
    w.writeVarUint(d.ownerSmallID);
    w.writeVarUint(d.pos);
    w.writeU8(d.reachedTarget ? 1 : 0);
  }
  return w.finish();
}

export function unpackEvents(bytes: Uint8Array): PackedEventLists {
  const r = new BinaryReader(bytes);
  const nukeImpacts: PackedEventLists["nukeImpacts"] = [];
  for (let n = r.readVarUint(); n > 0; n--) {
    const tick = r.readVarUint();
    const land = readTiles(r);
    nukeImpacts.push({ tick, land, water: readTiles(r) });
  }
  const deadUnitEvents: PackedEventLists["deadUnitEvents"] = [];
  for (let n = r.readVarUint(); n > 0; n--) {
    deadUnitEvents.push({
      tick: r.readVarUint(),
      unitId: r.readVarUint(),
      unitType: r.readShortString(),
      ownerSmallID: r.readVarUint(),
      pos: r.readVarUint(),
      reachedTarget: r.readU8() === 1,
    });
  }
  return { nukeImpacts, deadUnitEvents };
}

function writeTiles(w: BinaryWriter, tiles: readonly number[]): void {
  const sorted = [...tiles].sort((a, b) => a - b);
  w.writeVarUint(sorted.length);
  let prev = 0;
  for (const t of sorted) {
    w.writeVarUint(t - prev);
    prev = t;
  }
}

function readTiles(r: BinaryReader): number[] {
  const tiles: number[] = new Array(r.readVarUint());
  let t = 0;
  for (let i = 0; i < tiles.length; i++) {
    t += r.readVarUint();
    tiles[i] = t;
  }
  return tiles;
}
