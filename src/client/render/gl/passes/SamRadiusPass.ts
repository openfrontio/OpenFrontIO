/**
 * SAMRadiusPass — renders rotating dashed circles around SAM launchers
 * when the player is in build mode (ghost preview active).
 *
 * Allied SAM ranges are merged via circle union: overlapping circles from
 * the same alliance group show as a single combined shape rather than
 * overlapping rings. Each circle's visible (uncovered) arcs are emitted
 * as separate instances.
 *
 * Colors by ownership relationship:
 *   self  → green  (0, 1, 0)
 *   ally  → yellow (1, 1, 0)
 *   enemy → red    (1, 0, 0)
 */

import type { UnitState } from "../../types";
import { UT_SAM_LAUNCHER } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";
import { samRange } from "../utils/NukeTrajectory";

import fragSrc from "../shaders/sam-radius/sam-radius.frag.glsl?raw";
import vertSrc from "../shaders/sam-radius/sam-radius.vert.glsl?raw";

const TWO_PI = Math.PI * 2;
const EPS = 1e-9;
const TICK_INTERVAL_MS = 100;

// Per-instance: x, y, radius, r, g, b, alpha, arcStart, arcEnd, spin
const FLOATS_PER_INSTANCE = 10;

// Relationship colors
const COLOR_SELF = [0, 1, 0]; // green
const COLOR_ALLY = [1, 1, 0]; // yellow
const COLOR_ENEMY = [1, 0, 0]; // red

interface SAMCircle {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  group: number; // alliance group: 0 = friendly, 1 = enemy
  spin: number; // 1.0 = spinning, 0.0 = static
}

type Interval = [number, number];

function compareIntervalStart(a: Interval, b: Interval): number {
  return a[0] - b[0];
}

// ---------------------------------------------------------------------------
// Circle union geometry
// ---------------------------------------------------------------------------

function normalizeAngle(a: number): number {
  while (a < 0) a += TWO_PI;
  while (a >= TWO_PI) a -= TWO_PI;
  return a;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  // Split wrapping intervals, then merge
  const flat: Interval[] = [];
  for (const [s, e] of intervals) {
    const ns = normalizeAngle(s);
    const ne = normalizeAngle(e);
    if (ne < ns) {
      flat.push([ns, TWO_PI]);
      flat.push([0, ne]);
    } else {
      flat.push([ns, ne]);
    }
  }
  flat.sort(compareIntervalStart);

  const merged: Interval[] = [];
  let cur: Interval = [flat[0][0], flat[0][1]];
  for (let i = 1; i < flat.length; i++) {
    const it = flat[i];
    if (it[0] <= cur[1] + EPS) {
      cur[1] = Math.max(cur[1], it[1]);
    } else {
      merged.push(cur);
      cur = [it[0], it[1]];
    }
  }
  merged.push(cur);
  return merged;
}

/** Compute the uncovered arc intervals for circle `a` given all circles. */
function computeUncoveredArcs(a: SAMCircle, circles: SAMCircle[]): Interval[] {
  const covered: Interval[] = [];

  for (let i = 0; i < circles.length; i++) {
    const b = circles[i];
    if (a === b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dSq = dx * dx + dy * dy;
    if (dSq <= EPS) continue;

    // 1. Fast Enclosure Check (if a is engulfed inside b -> emit 0 quads)
    const diff = b.radius - a.radius;
    if (diff >= 0 && dSq <= diff * diff + EPS) return [];

    // 2. Fast Disjoint Check (90%+ of circle pairs rejected with 0 sqrt/trig)
    const maxDist = a.radius + b.radius;
    if (dSq >= maxDist * maxDist - EPS) continue;

    // 3. Exact arc angle calculation only on intersecting circles
    const d = Math.sqrt(dSq);
    const cosPhi =
      (a.radius * a.radius + dSq - b.radius * b.radius) / (2 * a.radius * d);
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
    const theta = Math.atan2(dy, dx);
    covered.push([theta - phi, theta + phi]);
  }

  const merged = mergeIntervals(covered);
  if (merged.length === 0) return [[0, TWO_PI]];

  const uncovered: Interval[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const [s, e] = merged[i];
    if (s > cursor + EPS) uncovered.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < TWO_PI - EPS) uncovered.push([cursor, TWO_PI]);

  return uncovered;
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export class SAMRadiusPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;

  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uOutline: WebGLUniformLocation;
  private uStrokeWidth: WebGLUniformLocation;
  private uDashLen: WebGLUniformLocation;
  private uGapLen: WebGLUniformLocation;
  private uRotationSpeed: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private uOutlineWidth: WebGLUniformLocation;
  private uOutlineSoftness: WebGLUniformLocation;

  private settings: RenderSettings;
  private instanceCount = 0;
  private visible = false;
  private mapW = 0;
  private startTime = performance.now();

  private localPlayerID = 0;
  private allies = new Set<number>();
  private currentTick = 0;
  private lastTickTime: number = performance.now();
  private hasUpgradingSAM: boolean = false;
  private groupBuckets: SAMCircle[][] = [];
  private lastGeometryTime = 0;
  private static readonly GEOMETRY_REFRESH_INTERVAL_MS = 50; // 20Hz refresh rate
  private dirtyGroups: Set<number> = new Set();
  private readonly colorScratch: number[] = [0, 0, 0];

  // Owner-color mode fields
  private paletteData: Float32Array | null = null;
  private colorMode: "perspective" | "owner" = "perspective";
  private allianceClusters: Map<number, number> = new Map();
  private lastStructures: Map<number, UnitState> | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.settings = settings;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uOutline = gl.getUniformLocation(this.program, "uOutline")!;
    this.uStrokeWidth = gl.getUniformLocation(this.program, "uStrokeWidth")!;
    this.uDashLen = gl.getUniformLocation(this.program, "uDashLen")!;
    this.uGapLen = gl.getUniformLocation(this.program, "uGapLen")!;
    this.uRotationSpeed = gl.getUniformLocation(
      this.program,
      "uRotationSpeed",
    )!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;
    this.uOutlineWidth = gl.getUniformLocation(this.program, "uOutlineWidth")!;
    this.uOutlineSoftness = gl.getUniformLocation(
      this.program,
      "uOutlineSoftness",
    )!;

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer: [x, y, radius, r, g, b, arcStart, arcEnd]
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      64,
      FLOATS_PER_INSTANCE,
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    const stride = FLOATS_PER_INSTANCE * 4;

    // Attribute 1: per-instance vec3 (x, y, radius)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec4 (r, g, b, alpha)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: per-instance vec3 (arcStart, arcEnd, spin)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);
  }

  /** Set the local player's ID (from ghost preview ownerID). */
  setLocalPlayer(id: number): void {
    if (id === this.localPlayerID) return;
    this.localPlayerID = id;
    this.rebuild();
  }

  /** Update ally set (player smallIDs allied with local player). */
  setAllies(allies: Set<number>): void {
    this.allies = allies;
    this.rebuild();
  }

  setPaletteData(data: Float32Array): void {
    this.paletteData = data;
  }

  setColorMode(mode: "perspective" | "owner"): void {
    if (mode === this.colorMode) return;
    this.colorMode = mode;
    this.rebuild();
  }

  setAllianceClusters(clusters: Map<number, number>): void {
    this.allianceClusters = clusters;
  }

  setTick(tick: number): void {
    if (tick === this.currentTick) return;
    this.currentTick = tick;
    this.lastTickTime = performance.now();
    if (this.hasUpgradingSAM) {
      this.rebuild();
    }
  }

  private getContinuousTick(): number {
    const subTick = Math.min(
      1,
      Math.max(0, (performance.now() - this.lastTickTime) / TICK_INTERVAL_MS),
    );
    return this.currentTick + subTick;
  }

  private rebuild(): void {
    if (this.lastStructures) this.updateStructures(this.lastStructures);
  }

  /** Call with current structures to update SAM positions/radii/colors. */
  updateStructures(
    structures: Map<number, UnitState>,
    currentTick?: number,
  ): void {
    if (currentTick !== undefined) {
      this.currentTick = currentTick;
      this.lastTickTime = performance.now();
    }
    this.lastGeometryTime = performance.now();
    this.lastStructures = structures;
    const circles = this.collectSAMCircles(
      structures,
      this.getContinuousTick(),
    );
    this.uploadInstances(circles);
  }

  private getSAMBaseGroup(u: UnitState, isFriendly: boolean): number {
    return this.colorMode === "owner"
      ? (this.allianceClusters.get(u.ownerID) ?? u.ownerID)
      : isFriendly
        ? 0
        : 1;
  }

  private getSAMColor(ownerID: number, isFriendly: boolean): number[] {
    if (this.colorMode === "owner" && this.paletteData) {
      const off = ownerID * 4;
      if (off + 2 < this.paletteData.length) {
        this.colorScratch[0] = this.paletteData[off];
        this.colorScratch[1] = this.paletteData[off + 1];
        this.colorScratch[2] = this.paletteData[off + 2];
        return this.colorScratch;
      }
    }
    return ownerID === this.localPlayerID
      ? COLOR_SELF
      : this.allies.has(ownerID)
        ? COLOR_ALLY
        : COLOR_ENEMY;
  }

  private collectSAMCircles(
    structures: Map<number, UnitState>,
    continuousTick: number,
  ): SAMCircle[] {
    const circles: SAMCircle[] = [];
    const w = this.mapW;
    this.dirtyGroups.clear();

    for (const u of structures.values()) {
      if (u.unitType !== UT_SAM_LAUNCHER || !u.isActive) continue;
      const isFriendly =
        u.ownerID === this.localPlayerID || this.allies.has(u.ownerID);
      const bg = this.getSAMBaseGroup(u, isFriendly);
      const startTick = u.samUpgradeStartTick;
      const duration = u.samUpgradeDuration ?? 0;
      if (
        startTick !== null &&
        continuousTick >= startTick &&
        continuousTick - startTick < duration
      ) {
        this.dirtyGroups.add(bg);
      }
    }
    this.hasUpgradingSAM = this.dirtyGroups.size > 0;

    for (const u of structures.values()) {
      if (u.unitType !== UT_SAM_LAUNCHER || !u.isActive) continue;
      const isFriendly =
        u.ownerID === this.localPlayerID || this.allies.has(u.ownerID);
      const bg = this.getSAMBaseGroup(u, isFriendly);
      const color = this.getSAMColor(u.ownerID, isFriendly);
      const x = u.pos % w;
      const y = (u.pos - x) / w;
      this.pushSAMCircles(
        circles,
        u,
        x,
        y,
        color,
        bg,
        continuousTick,
        isFriendly,
        this.dirtyGroups.has(bg),
      );
    }
    return circles;
  }

  private pushSAMCircles(
    circles: SAMCircle[],
    u: UnitState,
    x: number,
    y: number,
    color: number[],
    baseGroup: number,
    continuousTick: number,
    isFriendly: boolean,
    isGroupUpgrading: boolean,
  ): void {
    const startTick = u.samUpgradeStartTick;
    const duration = u.samUpgradeDuration ?? 0;
    const activeGroup = baseGroup * 2;
    const previewGroup = baseGroup * 2 + 1;

    if (
      startTick !== null &&
      continuousTick >= startTick &&
      continuousTick - startTick < duration
    ) {
      const elapsed = continuousTick - startTick;
      const progress = Math.max(0, Math.min(1, elapsed / duration));
      const targetRadius = samRange(u.samUpgradeTargetLevel ?? 0);
      const startRange = u.samUpgradeStartRange ?? 0;
      const currentRadius = startRange + (targetRadius - startRange) * progress;

      // Layer 0: Active operating radius
      circles.push({
        x,
        y,
        radius: currentRadius,
        r: color[0],
        g: color[1],
        b: color[2],
        alpha: isFriendly ? 1.0 : 0.35,
        group: activeGroup,
        spin: isFriendly ? 1.0 : 0.0,
      });
      // Layer 1: Target preview network
      circles.push({
        x,
        y,
        radius: targetRadius,
        r: color[0],
        g: color[1],
        b: color[2],
        alpha: isFriendly ? 0.35 : 1.0,
        group: previewGroup,
        spin: isFriendly ? 0.0 : 1.0,
      });
    } else {
      // Layer 0: Active operating radius
      circles.push({
        x,
        y,
        radius: samRange(u.level),
        r: color[0],
        g: color[1],
        b: color[2],
        alpha: 1.0,
        group: activeGroup,
        spin: 1.0,
      });
      // Layer 1: Connected static SAM preview network
      if (isGroupUpgrading) {
        circles.push({
          x,
          y,
          radius: samRange(u.level),
          r: color[0],
          g: color[1],
          b: color[2],
          alpha: isFriendly ? 0.35 : 1.0,
          group: previewGroup,
          spin: isFriendly ? 0.0 : 1.0,
        });
      }
    }
  }

  private uploadInstances(circles: SAMCircle[]): void {
    for (let i = 0; i < this.groupBuckets.length; i++) {
      const bucket = this.groupBuckets[i];
      if (bucket) bucket.length = 0;
    }

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      let bucket = this.groupBuckets[c.group];
      if (!bucket) {
        bucket = [];
        this.groupBuckets[c.group] = bucket;
      }
      bucket.push(c);
    }

    let count = 0;
    for (let g = 0; g < this.groupBuckets.length; g++) {
      const groupCircles = this.groupBuckets[g];
      if (!groupCircles || groupCircles.length === 0) continue;

      for (let i = 0; i < groupCircles.length; i++) {
        const c = groupCircles[i];
        const arcs = computeUncoveredArcs(c, groupCircles);
        for (let j = 0; j < arcs.length; j++) {
          const [arcStart, arcEnd] = arcs[j];
          this.instanceBuf.ensureCapacity(count + 1);
          const off = count * FLOATS_PER_INSTANCE;
          const data = this.instanceBuf.float32;
          data[off + 0] = c.x;
          data[off + 1] = c.y;
          data[off + 2] = c.radius;
          data[off + 3] = c.r;
          data[off + 4] = c.g;
          data[off + 5] = c.b;
          data[off + 6] = c.alpha;
          data[off + 7] = arcStart;
          data[off + 8] = arcEnd;
          data[off + 9] = c.spin;
          count++;
        }
      }
    }

    this.instanceCount = count;
    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  /** Show/hide based on whether build mode is active. */
  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.visible || this.instanceCount === 0) return;

    const now = performance.now();
    if (
      this.hasUpgradingSAM &&
      this.lastStructures &&
      now - this.lastGeometryTime >= SAMRadiusPass.GEOMETRY_REFRESH_INTERVAL_MS
    ) {
      this.lastGeometryTime = now;
      const circles = this.collectSAMCircles(
        this.lastStructures,
        this.getContinuousTick(),
      );
      this.uploadInstances(circles);
    }

    const gl = this.gl;
    const time = (performance.now() - this.startTime) / 1000;
    const s = this.settings.samRadius;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, time);
    gl.uniform1f(this.uOutline, this.colorMode === "owner" ? 1.0 : 0.0);
    gl.uniform1f(this.uStrokeWidth, s.strokeWidth);
    gl.uniform1f(this.uDashLen, s.dashLen);
    gl.uniform1f(this.uGapLen, s.gapLen);
    gl.uniform1f(this.uRotationSpeed, s.rotationSpeed);
    gl.uniform1f(this.uAlpha, s.alpha);
    gl.uniform1f(this.uOutlineWidth, s.outlineWidth);
    gl.uniform1f(this.uOutlineSoftness, s.outlineSoftness);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
