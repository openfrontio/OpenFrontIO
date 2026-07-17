/**
 * SpiralTrails — per-nuke centerline polylines for the spiral nukeTrail
 * cosmetic, consumed by SpiralRibbonPass.
 *
 * Unlike TrailManager (per-tile state stamped into the trail texture), spiral
 * vortexes are pure animation: the renderer draws helix ribbons as geometry
 * from each nuke's path. This manager only records that path — ~1-tile-spaced
 * centerline samples with a smoothed perpendicular (strand offsets swing along
 * it) and the cumulative distance at each point. Samples are append-only; the
 * head-cone convergence is a function of (headDist - sampleDist) evaluated in
 * the ribbon vertex shader, so nothing here is ever rewritten. A nuke's
 * ribbon is dropped the moment the unit disappears, matching how TrailManager
 * clears a dead unit's stamped trail.
 *
 * The spiral nuke still stamps its plain centerline through TrailManager like
 * any other nuke, so alt view, death cleanup, and trail overlap behave
 * identically to non-cosmetic nukes — the ribbon is purely additive on top.
 */

import type { UnitState } from "../types";
import { SMOOTHED_NUKE_TYPES } from "../types";

export const MAX_TRAIL_STRANDS = 8;

const TAU = 2 * Math.PI;

// A spiral completes one full rotation every max(radius * PITCH_PER_RADIUS, 8)
// tiles of travel — pitch scales with amplitude so wide helixes don't zigzag.
const PITCH_PER_RADIUS = 4;
const MIN_PITCH = 8;
// Centerline samples per tile of travel — the ribbon strip's segment length.
const SAMPLES_PER_TILE = 2;

/** Floats per sample in SpiralRibbon.samples: cx, cy, px, py, d. */
export const SAMPLE_FLOATS = 5;

/** Spiral nuke-trail cosmetic parameters (from the owner's nukeTrail effect). */
export interface SpiralParams {
  radius: number; // helix amplitude in tiles
  strands: number; // helix strand count (clamped to MAX_TRAIL_STRANDS)
  rotationSpeed: number; // vortex spin, radians/sec
  colors: ReadonlyArray<readonly [number, number, number]>; // rgb 0..1
}

/** One live spiral nuke's path, exposed to the renderer as a live ref. */
export interface SpiralRibbon {
  readonly id: number; // unit id — stable key for per-ribbon GPU buffers
  readonly radius: number;
  readonly strands: number;
  readonly twist: number; // helix phase advance, radians per tile
  readonly rotationSpeed: number;
  readonly colors: ReadonlyArray<readonly [number, number, number]>;
  /** Cumulative centerline distance at the nuke's head (grows every tick). */
  headDist: number;
  /** Valid sample count; samples may have spare capacity beyond it. */
  sampleCount: number;
  /** [cx, cy, px, py, d] × sampleCount. Append-only; grown by doubling. */
  samples: Float32Array;
}

interface RibbonState extends SpiralRibbon {
  headDist: number;
  sampleCount: number;
  samples: Float32Array;
  lastPos: number; // tile ref of the last recorded head position
  // Unit direction of the previously appended segment. Per-sample
  // perpendiculars blend from it into the new segment's direction across the
  // segment, so strands turn smoothly on curved paths instead of kinking at
  // tick boundaries.
  dirX: number;
  dirY: number;
  hasDir: boolean;
}

export class SpiralTrails {
  // Per-owner spiral geometry (from the nukeTrail cosmetic); owners without
  // an entry get no ribbon.
  private readonly params = new Map<number, SpiralParams>();
  private readonly ribbonsById = new Map<number, RibbonState>();
  // Stable array instance — FrameData keeps a live ref to it.
  private readonly ribbonList: SpiralRibbon[] = [];
  private readonly mapW: number;

  constructor(mapW: number) {
    this.mapW = mapW;
  }

  /**
   * Set a player's spiral geometry. Applies to nukes that start after the
   * call; in-flight ribbons keep their geometry.
   */
  setParams(ownerID: number, params: SpiralParams): void {
    this.params.set(ownerID, {
      radius: params.radius,
      strands: Math.min(
        Math.max(Math.round(params.strands), 1),
        MAX_TRAIL_STRANDS,
      ),
      rotationSpeed: params.rotationSpeed,
      colors: params.colors,
    });
  }

  /** Live ref to the current ribbons (mutated in place each update). */
  getRibbons(): readonly SpiralRibbon[] {
    return this.ribbonList;
  }

  reset(): void {
    this.ribbonsById.clear();
    this.ribbonList.length = 0;
  }

  /**
   * Advance ribbons from the current unit set: extend the path of each live
   * spiral-owner nuke, drop ribbons whose unit disappeared.
   */
  update(units: Map<number, UnitState>, trackedIds: number[]): void {
    let changed = false;
    for (const id of this.ribbonsById.keys()) {
      if (!units.has(id)) {
        this.ribbonsById.delete(id);
        changed = true;
      }
    }
    for (const id of trackedIds) {
      const unit = units.get(id);
      if (!unit || !SMOOTHED_NUKE_TYPES.has(unit.unitType)) continue;
      let ribbon = this.ribbonsById.get(id);
      if (!ribbon) {
        const params = this.params.get(unit.ownerID);
        if (!params) continue;
        // Like TrailManager, stamp only up to lastPos — UnitPass renders the
        // missile interpolated lastPos→pos, and the ribbon must trail it.
        ribbon = this.newRibbon(id, params, unit.lastPos);
        this.ribbonsById.set(id, ribbon);
        changed = true;
      }
      if (unit.lastPos !== ribbon.lastPos) {
        this.advance(ribbon, unit.lastPos);
      }
    }
    if (changed) {
      this.ribbonList.length = 0;
      for (const r of this.ribbonsById.values()) this.ribbonList.push(r);
    }
  }

  private newRibbon(
    id: number,
    params: SpiralParams,
    startPos: number,
  ): RibbonState {
    const pitch = Math.max(params.radius * PITCH_PER_RADIUS, MIN_PITCH);
    return {
      id,
      radius: params.radius,
      strands: params.strands,
      twist: TAU / pitch,
      rotationSpeed: params.rotationSpeed,
      colors: params.colors,
      headDist: 0,
      sampleCount: 0,
      samples: new Float32Array(256 * SAMPLE_FLOATS),
      lastPos: startPos,
      dirX: 0,
      dirY: 0,
      hasDir: false,
    };
  }

  /** Append ~1/SAMPLES_PER_TILE-spaced samples along lastPos → head. */
  private advance(r: RibbonState, head: number): void {
    const w = this.mapW;
    const x0 = r.lastPos % w;
    const y0 = (r.lastPos - x0) / w;
    const x1 = head % w;
    const y1 = (head - x1) / w;
    r.lastPos = head;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) return;
    const ndx = dx / segLen;
    const ndy = dy / segLen;
    const fromDirX = r.hasDir ? r.dirX : ndx;
    const fromDirY = r.hasDir ? r.dirY : ndy;
    const dirAt = (f: number): [number, number] => {
      const bx = fromDirX + (ndx - fromDirX) * f;
      const by = fromDirY + (ndy - fromDirY) * f;
      const len = Math.hypot(bx, by);
      if (len < 1e-6) return [ndx, ndy]; // 180° turn — no meaningful blend
      return [bx / len, by / len];
    };
    if (r.sampleCount === 0) {
      const [bx, by] = dirAt(0);
      this.pushSample(r, x0, y0, -by, bx, 0);
    }
    const steps = Math.ceil(segLen * SAMPLES_PER_TILE);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const [bx, by] = dirAt(f);
      this.pushSample(
        r,
        x0 + dx * f,
        y0 + dy * f,
        -by,
        bx,
        r.headDist + segLen * f,
      );
    }
    r.dirX = ndx;
    r.dirY = ndy;
    r.hasDir = true;
    r.headDist += segLen;
  }

  private pushSample(
    r: RibbonState,
    cx: number,
    cy: number,
    px: number,
    py: number,
    d: number,
  ): void {
    const off = r.sampleCount * SAMPLE_FLOATS;
    if (off + SAMPLE_FLOATS > r.samples.length) {
      const grown = new Float32Array(r.samples.length * 2);
      grown.set(r.samples);
      r.samples = grown;
    }
    r.samples[off] = cx;
    r.samples[off + 1] = cy;
    r.samples[off + 2] = px;
    r.samples[off + 3] = py;
    r.samples[off + 4] = d;
    r.sampleCount++;
  }
}
