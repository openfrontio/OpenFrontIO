/**
 * The map's terrain at the current replay frame: the map's original bytes
 * plus the changes stored in the replay (water nukes turn land into water
 * and reshape the coast). The live client gets these as terrain bytes on
 * tile updates (GameView.updatedTerrainTiles).
 */

import type { ReplayFrame } from "./codec/ReplayTypes";

/** GameMapImpl.IS_LAND_BIT. */
const LAND = 1 << 7;

export class ReplayTerrain {
  /** Current terrain byte per tile. */
  readonly bytes: Uint8Array;
  /**
   * Land tiles gained since the start (negative: water nukes sank them),
   * like GameMap.updateTile keeps numLandTiles.
   */
  landChange = 0;
  /** Tiles that may differ from the map's own bytes. */
  private readonly touched = new Set<number>();

  constructor(private readonly base: Uint8Array) {
    this.bytes = base.slice();
  }

  private set(ref: number, byte: number): void {
    this.landChange += ((byte & LAND) >> 7) - ((this.bytes[ref] & LAND) >> 7);
    this.bytes[ref] = byte;
  }

  /** Update the terrain to frame `f` and return the tiles that changed. */
  apply(f: ReplayFrame): number[] {
    if (f.changedTerrain !== null) {
      for (const ref of f.changedTerrain) {
        this.set(ref, f.terrain.get(ref)!);
        this.touched.add(ref);
      }
      return f.changedTerrain;
    }
    // Keyframe or seek: the list has every changed tile. Only report the
    // ones that are actually different, so crossing into a new chunk
    // doesn't re-upload anything.
    const changed = new Set<number>();
    for (const ref of this.touched) {
      const want = f.terrain.get(ref) ?? this.base[ref];
      if (this.bytes[ref] !== want) {
        this.set(ref, want);
        changed.add(ref);
      }
    }
    this.touched.clear();
    for (const [ref, byte] of f.terrain) {
      this.touched.add(ref);
      if (this.bytes[ref] !== byte) {
        this.set(ref, byte);
        changed.add(ref);
      }
    }
    return [...changed];
  }
}
