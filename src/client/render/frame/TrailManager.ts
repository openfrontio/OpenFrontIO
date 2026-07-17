/**
 * TrailManager — per-tile "last owner" stamp for trail rendering.
 *
 * Each tick, for each tracked unit, stamps tiles between lastPos and pos
 * (bresenham) with a 32-bit value: owner smallID in bits 0-11, plus a nuke bit
 * (bit 12) so nuke trails can be colored by a different cosmetic effect than
 * boat trails. Nukes whose owner has a spiral nukeTrail cosmetic stamp helix
 * strands around the centerline instead (quantized helix angle in bits 13-20),
 * converging into the missile at the head. When a unit dies its tiles are
 * cleared, with overlapping tiles repainted from any surviving unit
 * (preserving that survivor's full value).
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
// Bits 13-20 carry a spiral-stamped tile's quantized helix angle around the
// vortex axis (256 × 1.4° buckets — fine enough that colors sweep smoothly
// along a strand). trail.frag.glsl reads (val >> 13) & 255, spins the angle
// over time, and derives color + a front/back depth cue from it, so the flat
// stamp reads as a rotating 3D vortex. 0 for plain trails.
export const TRAIL_PHASE_SHIFT = 13;
export const SPIRAL_PHASE_BUCKETS = 256;
export const MAX_TRAIL_STRANDS = 8;

const TAU = 2 * Math.PI;

/** theta (radians) → its phase bucket (0..SPIRAL_PHASE_BUCKETS-1). */
function phaseBucket(theta: number): number {
  const t = theta / TAU;
  return (
    Math.floor((t - Math.floor(t)) * SPIRAL_PHASE_BUCKETS) &
    (SPIRAL_PHASE_BUCKETS - 1)
  );
}

// Depth (cos of the bucket's center angle) per bucket — how much a helix
// segment in that bucket faces the viewer. Used to let front segments win
// tile crossings over back segments (painter's algorithm).
const BUCKET_DEPTH = Float64Array.from(
  { length: SPIRAL_PHASE_BUCKETS },
  (_, b) => Math.cos(((b + 0.5) / SPIRAL_PHASE_BUCKETS) * TAU),
);

/** Spiral nuke-trail geometry (from the owner's nukeTrail cosmetic). */
export interface SpiralParams {
  radius: number; // helix amplitude in tiles
  strands: number; // helix strand count (clamped to MAX_TRAIL_STRANDS)
}

// A spiral completes one full rotation every max(radius * PITCH_PER_RADIUS, 8)
// tiles of travel — pitch scales with amplitude so wide helixes don't zigzag.
const PITCH_PER_RADIUS = 4;
const MIN_PITCH = 8;
// Centerline samples per tile of travel. 2× oversampling makes steep strand
// sections (fast lateral swing) stamp independently-rounded points instead
// of repeating one column, so the shader's sub-tile reconstruction has real
// signal to average.
const SAMPLES_PER_TILE = 2;

/** A centerline point within the head cone, kept for per-tick re-stamping. */
interface SpiralSample {
  cx: number;
  cy: number;
  // Unit perpendicular of the segment the sample lies on — strand offsets
  // swing along it.
  px: number;
  py: number;
  d: number; // cumulative centerline distance at this point
}

interface SpiralState {
  radius: number;
  strands: number;
  twist: number; // helix phase advance, radians per tile traveled
  dist: number; // cumulative tiles traveled along the centerline (the head)
  // Last finalized (full-amplitude) point per strand (world coords, may be out
  // of bounds so we can't store refs); valid once hasPrev is set.
  prevX: Int32Array;
  prevY: Int32Array;
  hasPrev: boolean;
  // The strands converge into the nuke: amplitude ramps 0 → radius over one
  // helix pitch behind the head ("the cone"), then runs straight at full
  // radius. A tile's distance-behind-head changes every tick, so the cone
  // zone is provisional: `samples` holds the centerline still inside the
  // cone, and `rampTiles` (ref → stamped value) the cone's texels, undone and
  // re-stamped on every advance. Samples that fall a full pitch behind the
  // head are finalized at full amplitude and leave the buffer.
  samples: SpiralSample[];
  rampTiles: Map<number, number>;
  // Unit direction of the previously appended segment. Each tick's segment
  // has one direction; using it directly kinks the strands at every tick
  // boundary on curved paths, so per-sample perpendiculars blend from this
  // into the new segment's direction across the segment.
  dirX: number;
  dirY: number;
  hasDir: boolean;
}

interface UnitTrail {
  // Stamped texel value: owner smallID | (isNuke ? NUKE_TRAIL_BIT : 0).
  // Spiral tiles additionally carry their phase bucket in bits 13-20.
  value: number;
  // ref → stamped texel value. Per-tile because spiral tiles differ in their
  // phase bits; plain trails store a uniform value.
  tiles: Map<number, number>;
  lastPosStamped: number; // tile ref of the last position we stamped
  spiral: SpiralState | null;
}

export class TrailManager {
  private readonly trailState: Uint32Array;
  private readonly unitTrails = new Map<number, UnitTrail>();
  // Per-owner spiral geometry for nuke trails (from the nukeTrail cosmetic);
  // owners without an entry stamp the plain centerline.
  private readonly spiralParams = new Map<number, SpiralParams>();
  private readonly mapW: number;
  private readonly mapH: number;

  private _dirtyRowMin = Infinity;
  private _dirtyRowMax = -1;

  // Bounding box [minX, minY, maxX, maxY] (tile coords, inclusive) of all
  // currently-stamped spiral tiles; empty when minX > maxX. Expand-only while
  // any spiral trail is active, reset to empty once none remain. The trail
  // shader only runs its (expensive) spiral gather inside these bounds, so
  // frames with no spiral nuke in flight pay nothing for the effect.
  private readonly spiralBounds = new Int32Array([1, 1, 0, 0]);

  constructor(mapW: number, mapH: number) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.trailState = new Uint32Array(mapW * mapH);
  }

  /**
   * Set (or clear) the spiral geometry for an owner's nuke trails. Applies to
   * trails that start after the call; in-flight trails keep their geometry.
   */
  setSpiralParams(ownerID: number, params: SpiralParams | null): void {
    if (params === null) {
      this.spiralParams.delete(ownerID);
      return;
    }
    this.spiralParams.set(ownerID, {
      radius: params.radius,
      strands: Math.min(
        Math.max(Math.round(params.strands), 1),
        MAX_TRAIL_STRANDS,
      ),
    });
  }

  getTrailState(): Uint32Array {
    return this.trailState;
  }

  /** Live ref to the spiral-tile bounds (see spiralBounds). */
  getSpiralBounds(): Int32Array {
    return this.spiralBounds;
  }

  private resetSpiralBounds(): void {
    this.spiralBounds.set([1, 1, 0, 0]);
  }

  private expandSpiralBounds(x: number, y: number): void {
    const b = this.spiralBounds;
    if (b[0] > b[2]) {
      b[0] = b[2] = x;
      b[1] = b[3] = y;
      return;
    }
    if (x < b[0]) b[0] = x;
    else if (x > b[2]) b[2] = x;
    if (y < b[1]) b[1] = y;
    else if (y > b[3]) b[3] = y;
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
    this._dirtyRowMin = Infinity;
    this._dirtyRowMax = -1;
    this.resetSpiralBounds();
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
        const params = isNuke ? this.spiralParams.get(unit.ownerID) : undefined;
        trail = {
          value,
          tiles: new Map(),
          lastPosStamped: -1,
          spiral: params ? this.newSpiralState(params) : null,
        };
        this.unitTrails.set(id, trail);
      }
      // Smoothed nukes render lastPos→pos interpolated per frame (UnitPass);
      // stamp their trail only up to lastPos so the tail never leads the
      // rendered missile.
      const head = isNuke ? unit.lastPos : unit.pos;
      if (trail.lastPosStamped === -1) {
        // First sighting — just stamp the current head. Spiral strands need a
        // travel direction, so they start on the first advance instead.
        if (trail.spiral === null) {
          this.stampTrailTile(head, trail.value, trail.tiles);
        }
        trail.lastPosStamped = head;
      } else if (trail.lastPosStamped !== head) {
        if (trail.spiral === null) {
          this.bresenham(trail.lastPosStamped, head, trail);
        } else {
          this.advanceSpiral(trail, trail.lastPosStamped, head);
        }
        trail.lastPosStamped = head;
      }
    }
    // Once no spiral trail remains (its tiles are cleared with the unit),
    // collapse the bounds so the shader's gather region goes back to empty.
    let anySpiral = false;
    for (const trail of this.unitTrails.values()) {
      if (trail.spiral !== null) {
        anySpiral = true;
        break;
      }
    }
    if (!anySpiral) this.resetSpiralBounds();
  }

  private clearDeadUnits(units: Map<number, UnitState>): void {
    for (const [id, trail] of this.unitTrails) {
      if (units.has(id)) continue;
      // A spiral trail's cone tiles live in rampTiles, not tiles — clear both.
      const deadRefs = [...trail.tiles.keys()];
      if (trail.spiral) deadRefs.push(...trail.spiral.rampTiles.keys());
      for (const ref of deadRefs) this.stamp(ref, 0);
      this.unitTrails.delete(id);
      // Repaint any tiles that overlap surviving trails — with the survivor's
      // per-tile value so its strand bits, nuke bit, and owner are preserved.
      for (const ref of deadRefs) {
        const v = this.survivingValueAt(ref);
        if (v !== 0) this.stamp(ref, v);
      }
    }
  }

  /**
   * The texel value a surviving trail holds at ref (finalized tiles first,
   * then provisional cone tiles), or 0 if no trail covers it. Used to restore
   * tiles uncovered by a death or a cone re-stamp.
   */
  private survivingValueAt(ref: number): number {
    for (const trail of this.unitTrails.values()) {
      const v = trail.tiles.get(ref);
      if (v !== undefined) return v;
      const rv = trail.spiral?.rampTiles.get(ref);
      if (rv !== undefined) return rv;
    }
    return 0;
  }

  private stamp(ref: number, value: number): void {
    this.trailState[ref] = value;
    const row = (ref / this.mapW) | 0;
    if (row < this._dirtyRowMin) this._dirtyRowMin = row;
    if (row > this._dirtyRowMax) this._dirtyRowMax = row;
  }

  /** Stamp one trail tile: record it in the tiles map and write the texel. */
  private stampTrailTile(
    ref: number,
    value: number,
    tiles: Map<number, number>,
  ): void {
    tiles.set(ref, value);
    this.stamp(ref, value);
  }

  private newSpiralState(params: SpiralParams): SpiralState {
    const pitch = Math.max(params.radius * PITCH_PER_RADIUS, MIN_PITCH);
    return {
      radius: params.radius,
      strands: params.strands,
      twist: (2 * Math.PI) / pitch,
      dist: 0,
      prevX: new Int32Array(params.strands),
      prevY: new Int32Array(params.strands),
      hasPrev: false,
      samples: [],
      rampTiles: new Map(),
      dirX: 0,
      dirY: 0,
      hasDir: false,
    };
  }

  /** Cone length in tiles = one helix pitch (the inverse of twist). */
  private coneLength(s: SpiralState): number {
    return (2 * Math.PI) / s.twist;
  }

  /**
   * Advance a spiral trail along the centerline segment from → to: append
   * ~1-tile-spaced centerline samples, then re-stamp. Each strand sits at a
   * sinusoidal perpendicular offset (a helix seen top-down, phase advancing
   * with distance traveled), scaled by the cone envelope — 0 at the head so
   * the strands emerge from the nuke, full radius one pitch behind it.
   * Strand points may leave the map on wide helixes — stamping is
   * bounds-checked per tile.
   */
  private advanceSpiral(trail: UnitTrail, from: number, to: number): void {
    const s = trail.spiral!;
    const w = this.mapW;
    const x0 = from % w;
    const y0 = (from - x0) / w;
    const x1 = to % w;
    const y1 = (to - x1) / w;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) return;
    const ndx = dx / segLen;
    const ndy = dy / segLen;
    // Per-sample direction blends from the previous segment's into this
    // one's across the segment, so the strand perpendiculars turn smoothly
    // on curved paths instead of kinking at every tick boundary.
    const fromDirX = s.hasDir ? s.dirX : ndx;
    const fromDirY = s.hasDir ? s.dirY : ndy;
    const dirAt = (f: number): [number, number] => {
      const bx = fromDirX + (ndx - fromDirX) * f;
      const by = fromDirY + (ndy - fromDirY) * f;
      const len = Math.hypot(bx, by);
      if (len < 1e-6) return [ndx, ndy]; // 180° turn — no meaningful blend
      return [bx / len, by / len];
    };
    if (s.samples.length === 0) {
      const [bx, by] = dirAt(0);
      s.samples.push({ cx: x0, cy: y0, px: -by, py: bx, d: s.dist });
    }
    const steps = Math.ceil(segLen * SAMPLES_PER_TILE);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const [bx, by] = dirAt(f);
      s.samples.push({
        cx: x0 + dx * f,
        cy: y0 + dy * f,
        px: -by,
        py: bx,
        d: s.dist + segLen * f,
      });
    }
    s.dirX = ndx;
    s.dirY = ndy;
    s.hasDir = true;
    s.dist += segLen;
    this.restampSpiral(trail);
  }

  /**
   * Re-stamp a spiral trail's head cone. Undoes last tick's provisional cone
   * tiles (restoring whatever trail still covers them), finalizes samples
   * that fell a full pitch behind the head at full amplitude, then stamps the
   * remaining cone samples with the ramped amplitude. Strand points connect
   * to their predecessor (finalized frontier first) so strands stay
   * continuous across steps and ticks.
   */
  private restampSpiral(trail: UnitTrail): void {
    const s = trail.spiral!;
    const cone = this.coneLength(s);

    for (const ref of s.rampTiles.keys()) {
      this.stamp(ref, trail.tiles.get(ref) ?? 0);
    }
    // Own finalized tiles are restored above; other trails' tiles (rare
    // crossings) are restored after the ramp map is rebuilt below, so
    // survivingValueAt doesn't read the stale ramp.
    const uncovered = [...s.rampTiles.keys()].filter(
      (ref) => !trail.tiles.has(ref),
    );
    s.rampTiles.clear();

    // Finalize samples beyond the cone at full amplitude.
    while (s.samples.length > 0 && s.dist - s.samples[0].d >= cone) {
      const smp = s.samples.shift()!;
      this.stampSpiralSample(
        trail,
        smp,
        s.radius,
        trail.tiles,
        s.prevX,
        s.prevY,
        s.hasPrev,
      );
      s.hasPrev = true;
    }

    // Stamp the cone: amplitude eases from full radius at the cone's back
    // edge to 0 at the head, so the strands converge into the nuke.
    const provX = new Int32Array(s.strands);
    const provY = new Int32Array(s.strands);
    let hasProv = false;
    if (s.hasPrev) {
      provX.set(s.prevX);
      provY.set(s.prevY);
      hasProv = true;
    }
    for (const smp of s.samples) {
      const behind = Math.min((s.dist - smp.d) / cone, 1);
      const amp = s.radius * Math.sin((Math.PI / 2) * behind);
      this.stampSpiralSample(
        trail,
        smp,
        amp,
        s.rampTiles,
        provX,
        provY,
        hasProv,
      );
      hasProv = true;
    }

    for (const ref of uncovered) {
      if (s.rampTiles.has(ref)) continue;
      const v = this.survivingValueAt(ref);
      if (v !== 0) this.stamp(ref, v);
    }
  }

  /**
   * Stamp every strand of one centerline sample at the given amplitude,
   * connecting each strand to its previous point (prevX/prevY, updated in
   * place) when connect is set. The stamped value carries the strand point's
   * phase bucket — its quantized angle around the vortex axis — which the
   * shader turns into the spinning color + depth shading.
   */
  private stampSpiralSample(
    trail: UnitTrail,
    smp: SpiralSample,
    amp: number,
    tiles: Map<number, number>,
    prevX: Int32Array,
    prevY: Int32Array,
    connect: boolean,
  ): void {
    const s = trail.spiral!;
    const phaseStep = TAU / s.strands;
    for (let k = 0; k < s.strands; k++) {
      const theta = smp.d * s.twist + k * phaseStep;
      const off = amp * Math.sin(theta);
      const sx = Math.round(smp.cx + smp.px * off);
      const sy = Math.round(smp.cy + smp.py * off);
      const value = trail.value | (phaseBucket(theta) << TRAIL_PHASE_SHIFT);
      if (connect) {
        this.bresenhamPlot(prevX[k], prevY[k], sx, sy, (x, y) =>
          this.stampSpiralXY(x, y, value, tiles),
        );
      } else {
        this.stampSpiralXY(sx, sy, value, tiles);
      }
      prevX[k] = sx;
      prevY[k] = sy;
    }
  }

  /**
   * Stamp a spiral tile by coordinates. Where two strand segments of the same
   * trail cross in projection, the one facing the viewer (higher bucket
   * depth) keeps the tile — front occludes back, like a real 3D helix.
   */
  private stampSpiralXY(
    x: number,
    y: number,
    value: number,
    tiles: Map<number, number>,
  ): void {
    if (x < 0 || y < 0 || x >= this.mapW || y >= this.mapH) return;
    const ref = y * this.mapW + x;
    const existing = tiles.get(ref);
    const mask = SPIRAL_PHASE_BUCKETS - 1;
    if (
      existing !== undefined &&
      BUCKET_DEPTH[(existing >> TRAIL_PHASE_SHIFT) & mask] >
        BUCKET_DEPTH[(value >> TRAIL_PHASE_SHIFT) & mask]
    ) {
      return;
    }
    this.expandSpiralBounds(x, y);
    this.stampTrailTile(ref, value, tiles);
  }

  /** Stamp a trail tile by coordinates, skipping out-of-bounds points. */
  private stampXY(
    x: number,
    y: number,
    value: number,
    tiles: Map<number, number>,
  ): void {
    if (x < 0 || y < 0 || x >= this.mapW || y >= this.mapH) return;
    this.stampTrailTile(y * this.mapW + x, value, tiles);
  }

  private bresenham(from: number, to: number, trail: UnitTrail): void {
    const w = this.mapW;
    const x0 = from % w;
    const y0 = (from - x0) / w;
    const x1 = to % w;
    const y1 = (to - x1) / w;
    this.bresenhamPlot(x0, y0, x1, y1, (x, y) =>
      this.stampXY(x, y, trail.value, trail.tiles),
    );
  }

  private bresenhamPlot(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    plot: (x: number, y: number) => void,
  ): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
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
