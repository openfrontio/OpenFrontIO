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

// Per-instance: x, y, radius, r, g, b, arcStart, arcEnd
const FLOATS_PER_INSTANCE = 8;

// Relationship colors
const COLOR_SELF = [0, 1, 0]; // green
const COLOR_ALLY = [1, 1, 0]; // yellow
const COLOR_ENEMY = [1, 0, 0]; // red

interface SAMCircle {
  x: number;
  y: number;
  radius: number;
  color: number[];
  group: number; // alliance group: 0 = friendly, 1 = enemy
}

type Interval = [number, number];

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
  flat.sort((a, b) => a[0] - b[0]);

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

  for (const b of circles) {
    if (a === b) continue;
    if (a.group !== b.group) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);

    // a fully inside b → no visible arcs
    if (d + a.radius <= b.radius + EPS) return [];

    // No overlap
    if (d >= a.radius + b.radius - EPS) continue;

    // Coincident centers
    if (d <= EPS) {
      if (b.radius >= a.radius) return [];
      continue;
    }

    // Angular span on a covered by b (law of cosines)
    const cosPhi =
      (a.radius * a.radius + d * d - b.radius * b.radius) / (2 * a.radius * d);
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
    const theta = Math.atan2(dy, dx);
    covered.push([theta - phi, theta + phi]);
  }

  const merged = mergeIntervals(covered);

  // Subtract covered from [0, 2π)
  if (merged.length === 0) return [[0, TWO_PI]];

  const uncovered: Interval[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
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

    // Attribute 2: per-instance vec3 (r, g, b)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);

    // Attribute 3: per-instance vec2 (arcStart, arcEnd)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 24);
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

  private rebuild(): void {
    if (this.lastStructures) this.updateStructures(this.lastStructures);
  }

  /** Call with current structures to update SAM positions/radii/colors. */
  updateStructures(structures: Map<number, UnitState>): void {
    this.lastStructures = structures;
    const w = this.mapW;
    const ownerMode = this.colorMode === "owner";

    // 1. Collect SAM circles
    const circles: SAMCircle[] = [];
    for (const u of structures.values()) {
      if (u.unitType !== UT_SAM_LAUNCHER) continue;
      if (!u.isActive) continue;

      const x = u.pos % w;
      const y = (u.pos - x) / w;

      let color: number[];
      let group: number;

      if (ownerMode && this.paletteData) {
        // Owner-colored: palette color, alliance-cluster-based merging
        const off = u.ownerID * 4;
        color = [
          this.paletteData[off],
          this.paletteData[off + 1],
          this.paletteData[off + 2],
        ];
        group = this.allianceClusters.get(u.ownerID) ?? u.ownerID;
      } else {
        // Perspective: self/ally/enemy colors, binary group
        const isFriendly =
          u.ownerID === this.localPlayerID || this.allies.has(u.ownerID);
        color =
          u.ownerID === this.localPlayerID
            ? COLOR_SELF
            : this.allies.has(u.ownerID)
              ? COLOR_ALLY
              : COLOR_ENEMY;
        group = isFriendly ? 0 : 1;
      }

      circles.push({
        x,
        y,
        radius: samRange(u.level),
        color,
        group,
      });
    }

    // 2. Compute circle unions → uncovered arcs per circle
    let count = 0;
    for (const c of circles) {
      const arcs = computeUncoveredArcs(c, circles);

      for (const [arcStart, arcEnd] of arcs) {
        this.instanceBuf.ensureCapacity(count + 1);

        const off = count * FLOATS_PER_INSTANCE;
        const data = this.instanceBuf.float32;
        data[off + 0] = c.x;
        data[off + 1] = c.y;
        data[off + 2] = c.radius;
        data[off + 3] = c.color[0];
        data[off + 4] = c.color[1];
        data[off + 5] = c.color[2];
        data[off + 6] = arcStart;
        data[off + 7] = arcEnd;
        count++;
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
