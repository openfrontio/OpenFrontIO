/**
 * RailroadCache — always-on accumulator for railroad events.
 *
 * The game doesn't expose current railroad state via any API — it only sends
 * construction/destruction/snap delta events. This cache accumulates them
 * every tick so consumers that start later can reconstruct the full set.
 *
 * Includes orientation computation, construction animation, and a per-tile
 * Uint8Array ready for GPU upload.
 *
 * Ported verbatim from openfront-workspace/packages/shim/src/railroad-cache.ts;
 * only imports changed (types come from src/core/game/GameUpdates instead of
 * the shim's local types module).
 */

import {
  GameUpdateType,
  GameUpdateViewData,
  RailroadConstructionUpdate,
  RailroadDestructionUpdate,
  RailroadSnapUpdate,
} from "../../../core/game/GameUpdates";

// Regular enum (not const enum) for cross-package use.
export enum RailType {
  VERTICAL,
  HORIZONTAL,
  TOP_LEFT,
  TOP_RIGHT,
  BOTTOM_LEFT,
  BOTTOM_RIGHT,
}

interface RailTile {
  ref: number;
  type: RailType;
}

interface RailroadAnim {
  tiles: RailTile[];
  headIndex: number;
  tailIndex: number;
  complete: boolean;
}

const RAIL_INCREMENT = 3;

// ---------------------------------------------------------------------------
// Orientation helpers
// ---------------------------------------------------------------------------

function railExtremity(tile: number, next: number, w: number): RailType {
  const dx = (next % w) - (tile % w);
  const dy = (next - (next % w)) / w - (tile - (tile % w)) / w;
  if (dx === 0) return RailType.VERTICAL;
  if (dy === 0) return RailType.HORIZONTAL;
  return RailType.VERTICAL;
}

function railDirection(
  prev: number,
  cur: number,
  next: number,
  w: number,
): RailType {
  const x1 = prev % w,
    y1 = (prev - x1) / w;
  const x2 = cur % w,
    y2 = (cur - x2) / w;
  const x3 = next % w,
    y3 = (next - x3) / w;
  const dx1 = x2 - x1,
    dy1 = y2 - y1;
  const dx2 = x3 - x2,
    dy2 = y3 - y2;
  if (dx1 === dx2 && dy1 === dy2) {
    return dx1 !== 0 ? RailType.HORIZONTAL : RailType.VERTICAL;
  }
  if ((dx1 === 0 && dx2 !== 0) || (dx1 !== 0 && dx2 === 0)) {
    if (dx1 === 0 && dx2 === 1 && dy1 === -1) return RailType.BOTTOM_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === -1) return RailType.BOTTOM_LEFT;
    if (dx1 === 0 && dx2 === 1 && dy1 === 1) return RailType.TOP_RIGHT;
    if (dx1 === 0 && dx2 === -1 && dy1 === 1) return RailType.TOP_LEFT;
    if (dx1 === 1 && dx2 === 0 && dy2 === -1) return RailType.TOP_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === -1) return RailType.TOP_RIGHT;
    if (dx1 === 1 && dx2 === 0 && dy2 === 1) return RailType.BOTTOM_LEFT;
    if (dx1 === -1 && dx2 === 0 && dy2 === 1) return RailType.BOTTOM_RIGHT;
  }
  return RailType.VERTICAL;
}

function computeRailTiles(tileRefs: number[], w: number): RailTile[] {
  if (tileRefs.length === 0) return [];
  if (tileRefs.length === 1)
    return [{ ref: tileRefs[0]!, type: RailType.VERTICAL }];
  const result: RailTile[] = [];
  result.push({
    ref: tileRefs[0]!,
    type: railExtremity(tileRefs[0]!, tileRefs[1]!, w),
  });
  for (let i = 1; i < tileRefs.length - 1; i++) {
    result.push({
      ref: tileRefs[i]!,
      type: railDirection(tileRefs[i - 1]!, tileRefs[i]!, tileRefs[i + 1]!, w),
    });
  }
  const last = tileRefs.length - 1;
  result.push({
    ref: tileRefs[last]!,
    type: railExtremity(tileRefs[last]!, tileRefs[last - 1]!, w),
  });
  return result;
}

export class RailroadCache {
  private mapW: number;
  private anims = new Map<number, RailroadAnim>();

  /**
   * Per-tile reference count. Multiple railroads can share tiles at junctions
   * (near stations). A tile is only cleared from railroadState when its ref
   * count drops to zero.
   */
  private tileRefCount = new Map<number, number>();

  /** Per-tile railroad state (0=none, 1-6 = RailType+1). Ready for GPU upload. */
  readonly railroadState: Uint8Array;

  /** True if railroadState changed this tick. */
  railroadDirty = false;

  /** Tile refs revealed by animation this tick (for dust FX). */
  readonly revealedRailTiles: number[] = [];

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.railroadState = new Uint8Array(mapW * mapH);
  }

  /**
   * Process this tick's railroad events and advance animations.
   * Event order matches the upstream game client: Construction → Snap → Destruction.
   */
  apply(gu: GameUpdateViewData): void {
    const constructs = (gu.updates[GameUpdateType.RailroadConstructionEvent] ??
      []) as RailroadConstructionUpdate[];
    for (const evt of constructs) this.addRailroad(evt.id, evt.tiles, false);

    const snaps = (gu.updates[GameUpdateType.RailroadSnapEvent] ??
      []) as RailroadSnapUpdate[];
    for (const evt of snaps) {
      this.removeRailroad(evt.originalId);
      this.addRailroad(evt.newId1, evt.tiles1, true);
      this.addRailroad(evt.newId2, evt.tiles2, true);
    }

    const destructs = (gu.updates[GameUpdateType.RailroadDestructionEvent] ??
      []) as RailroadDestructionUpdate[];
    for (const evt of destructs) this.removeRailroad(evt.id);

    this.tickAnimations();
  }

  /** Clear the dirty flag after the consumer has uploaded the state. */
  clearDirty(): void {
    this.railroadDirty = false;
  }

  /** Get raw tile refs for the given railroad IDs (for ghost manager overlap resolution). */
  getRailroadTileRefs(ids: number[]): number[] {
    const tiles: number[] = [];
    for (const id of ids) {
      const anim = this.anims.get(id);
      if (anim) for (const t of anim.tiles) tiles.push(t.ref);
    }
    return tiles;
  }

  /** Read-only view of current railroads: id → raw tile refs. */
  getRailroads(): ReadonlyMap<number, number[]> {
    const result = new Map<number, number[]>();
    for (const [id, anim] of this.anims) {
      result.set(
        id,
        anim.tiles.map((t) => t.ref),
      );
    }
    return result;
  }

  reset(): void {
    this.anims.clear();
    this.tileRefCount.clear();
    this.railroadState.fill(0);
    this.railroadDirty = false;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private addRailroad(id: number, tileRefs: number[], complete: boolean): void {
    const tiles = computeRailTiles(tileRefs, this.mapW);
    const anim: RailroadAnim = {
      tiles,
      headIndex: complete ? tiles.length : 0,
      tailIndex: complete ? 0 : tiles.length,
      complete,
    };
    this.anims.set(id, anim);

    // Increment ref counts for all tiles in this railroad
    for (const rt of tiles) {
      this.tileRefCount.set(rt.ref, (this.tileRefCount.get(rt.ref) ?? 0) + 1);
    }

    if (complete) {
      for (const rt of tiles) this.railroadState[rt.ref] = rt.type + 1;
      this.railroadDirty = true;
    }
  }

  private removeRailroad(id: number): void {
    const anim = this.anims.get(id);
    if (!anim) return;

    // Decrement ref counts; only clear tiles whose count drops to zero
    for (const rt of anim.tiles) {
      const count = (this.tileRefCount.get(rt.ref) ?? 1) - 1;
      if (count <= 0) {
        this.tileRefCount.delete(rt.ref);
        this.railroadState[rt.ref] = 0;
      } else {
        this.tileRefCount.set(rt.ref, count);
      }
    }

    this.anims.delete(id);
    this.railroadDirty = true;
  }

  private tickAnimations(): void {
    this.revealedRailTiles.length = 0;
    for (const anim of this.anims.values()) {
      if (anim.complete) continue;
      if (anim.tailIndex - anim.headIndex <= 2 * RAIL_INCREMENT) {
        for (let i = anim.headIndex; i < anim.tailIndex; i++) {
          const t = anim.tiles[i]!;
          this.railroadState[t.ref] = t.type + 1;
          this.revealedRailTiles.push(t.ref);
        }
        anim.headIndex = anim.tailIndex;
        anim.complete = true;
        this.railroadDirty = true;
      } else {
        for (let i = anim.headIndex; i < anim.headIndex + RAIL_INCREMENT; i++) {
          const t = anim.tiles[i]!;
          this.railroadState[t.ref] = t.type + 1;
          this.revealedRailTiles.push(t.ref);
        }
        for (let i = anim.tailIndex - RAIL_INCREMENT; i < anim.tailIndex; i++) {
          const t = anim.tiles[i]!;
          this.railroadState[t.ref] = t.type + 1;
          this.revealedRailTiles.push(t.ref);
        }
        anim.headIndex += RAIL_INCREMENT;
        anim.tailIndex -= RAIL_INCREMENT;
        if (anim.headIndex >= anim.tailIndex) anim.complete = true;
        this.railroadDirty = true;
      }
    }
  }
}
