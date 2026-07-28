/**
 * TrailManager — per-tile "last owner" stamp for trail rendering.
 *
 * Each tick, for each tracked unit, stamps tiles between lastPos and pos
 * (bresenham) with a 16-bit value: owner smallID in bits 0-11, plus a nuke bit
 * (bit 12) so nuke trails can be colored by a different cosmetic effect than
 * boat trails. Each tile also carries a live-trail refcount; when a unit dies
 * its tiles are released and a texel is cleared only when its last claimant
 * dies. A tile shared with surviving trails keeps its last-stamped value — if
 * the overlapping trails carried different values (different owners, or boat
 * vs nuke), the crossing pixels can keep the dead trail's value until the
 * survivors die too. That pixel-level inexactness is the tradeoff for O(own
 * tiles) death cleanup: repainting from survivors would rescan every surviving
 * trail per death, which goes quadratic during MIRV strikes (hundreds of
 * long-trailed warheads dying in waves).
 *
 * Simpler than the original openfront-workspace TrailManager (no MotionPlanStore
 * dependency). Since we run in the main thread reading GameView directly, we
 * don't need plan-based reconstruction.
 */

import type { UnitState } from "../types";
import { SMOOTHED_NUKE_TYPES } from "../types";

// Bit 12 of the trail texel flags a nuke trail (vs a boat trail); bits 0-11 are
// the owner smallID. Must match the mask/shift in trail.frag.glsl (owner & 0xFFF,
// (val >> 12) & 1). SMOOTHED_NUKE_TYPES is exactly the nuke trail set today.
export const NUKE_TRAIL_BIT = 1 << 12;

interface UnitTrail {
  // Stamped texel value: owner smallID | (isNuke ? NUKE_TRAIL_BIT : 0).
  value: number;
  tiles: Set<number>;
  lastPosStamped: number; // tile ref of the last position we stamped
}

export class TrailManager {
  private readonly trailState: Uint16Array;
  // Number of live trails claiming each tile — a texel is cleared only when
  // its count drops to zero.
  private readonly trailCounts: Uint16Array;
  private readonly unitTrails = new Map<number, UnitTrail>();
  private readonly mapW: number;

  private _dirtyRowMin = Infinity;
  private _dirtyRowMax = -1;

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.trailState = new Uint16Array(mapW * mapH);
    this.trailCounts = new Uint16Array(mapW * mapH);
  }

  getTrailState(): Uint16Array {
    return this.trailState;
  }

  get dirtyRowMin(): number {
    return this._dirtyRowMin;
  }
  get dirtyRowMax(): number {
    return this._dirtyRowMax;
  }

  clearDirtyRows(): void {
    this._dirtyRowMin = Infinity;
    this._dirtyRowMax = -1;
  }

  reset(): void {
    this.unitTrails.clear();
    this.trailState.fill(0);
    this.trailCounts.fill(0);
    this._dirtyRowMin = Infinity;
    this._dirtyRowMax = -1;
  }

  /**
   * Update trails from the current unit set. Stamps tiles between lastPos and
   * pos (bresenham) for each tracked unit, and clears tiles for units that
   * have disappeared (overlapping tiles get repainted from survivors).
   */
  update(units: Map<number, UnitState>, trackedIds: number[]): void {
    this.clearDeadUnits(units);
    for (const id of trackedIds) {
      const unit = units.get(id);
      if (!unit) continue;
      const isNuke = SMOOTHED_NUKE_TYPES.has(unit.unitType);
      let trail = this.unitTrails.get(id);
      if (!trail) {
        const value = unit.ownerID | (isNuke ? NUKE_TRAIL_BIT : 0);
        trail = { value, tiles: new Set(), lastPosStamped: -1 };
        this.unitTrails.set(id, trail);
      }
      // Smoothed nukes render lastPos→pos interpolated per frame (UnitPass);
      // stamp their trail only up to lastPos so the tail never leads the
      // rendered missile.
      const head = isNuke ? unit.lastPos : unit.pos;
      if (trail.lastPosStamped === -1) {
        // First sighting — just stamp the current head
        this.claim(head, trail);
        trail.lastPosStamped = head;
      } else if (trail.lastPosStamped !== head) {
        this.bresenham(trail.lastPosStamped, head, trail);
        trail.lastPosStamped = head;
      }
    }
  }

  private clearDeadUnits(units: Map<number, UnitState>): void {
    for (const [id, trail] of this.unitTrails) {
      if (units.has(id)) continue;
      this.unitTrails.delete(id);
      // Release each tile: clear the texel only when the last claimant dies.
      // Tiles still claimed by a surviving trail keep their last-stamped value.
      for (const ref of trail.tiles) {
        if (--this.trailCounts[ref] === 0) this.stamp(ref, 0);
      }
    }
  }

  /** Stamp a tile for a trail, counting it once per trail for death cleanup. */
  private claim(ref: number, trail: UnitTrail): void {
    if (!trail.tiles.has(ref)) {
      trail.tiles.add(ref);
      this.trailCounts[ref]++;
    }
    this.stamp(ref, trail.value);
  }

  private stamp(ref: number, value: number): void {
    this.trailState[ref] = value;
    const row = (ref / this.mapW) | 0;
    if (row < this._dirtyRowMin) this._dirtyRowMin = row;
    if (row > this._dirtyRowMax) this._dirtyRowMax = row;
  }

  private bresenham(from: number, to: number, trail: UnitTrail): void {
    const w = this.mapW;
    let x0 = from % w;
    let y0 = (from - x0) / w;
    const x1 = to % w;
    const y1 = (to - x1) / w;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      const ref = y0 * w + x0;
      this.claim(ref, trail);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}
