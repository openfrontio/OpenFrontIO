/**
 * FxShockwavePass — instanced procedural ring quads.
 *
 * Spawned alongside sprite FX for nuke and SAM interception events.
 * Uses an SDF circle rendered in a unit quad, no texture required.
 */

import {
  DEFAULT_NUKE_EXPLOSION_COLOR,
  MAX_NUKE_EXPLOSION_COLORS,
  type NukeExplosionRenderParams,
} from "../../../types";
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import shockwaveFragSrc from "../../shaders/fx/shockwave.frag.glsl?raw";
import shockwaveVertSrc from "../../shaders/fx/shockwave.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

// SAM interception keeps the classic white ring (color fields go unused there).
const WHITE: RGB = [1, 1, 1];

interface ActiveShockwave {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
  maxRadius: number;
  style: number; // 0 = classic ring (SAM + no-cosmetic nuke), 1 = EMP, 2 = sparkles, 3 = embers
  colors: readonly RGB[]; // 1..MAX_NUKE_EXPLOSION_COLORS palette, never empty
  speed: number; // crackle-animation multiplier (effect pace vs the default)
  transitionSpeed: number; // palette step rate (colors/s); 0 = static, <0 = reverse
  thickness: number; // ring band / avg sparkle size (world tiles); unused by classic
  cell: number; // sparkles grid pitch; embers keep-fraction; 0 for other styles
}

// ---------------------------------------------------------------------------
// Instance data layout (22 floats):
//   x, y, radius, alpha, style, color0..color3 (rgb each), colorCount, speed,
//   transitionSpeed, thickness, cell. Unused color slots repeat the last
//   palette color so the shader can take a max over all four.
// ---------------------------------------------------------------------------

const QUAD_VERTS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
const SHOCKWAVE_FLOATS = 22;
const SHOCKWAVE_STRIDE = SHOCKWAVE_FLOATS * 4; // bytes

/**
 * Calculates shockwave/sparkle explosion duration in milliseconds,
 * clamped between 100ms and 15,000ms.
 */
export function calculateExplosionDurationMs(
  params: NukeExplosionRenderParams | undefined,
  defaultDurationMs: number,
): number {
  if (!params) return defaultDurationMs;
  const widthPx = params.maxRadius * 2;
  return Math.min(
    Math.max((widthPx / Math.max(params.speed, 0.001)) * 1000, 100),
    15_000,
  );
}

// ---------------------------------------------------------------------------
// FxShockwavePass
// ---------------------------------------------------------------------------

export class FxShockwavePass {
  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uRingWidth: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private quadVbo: WebGLBuffer;
  private instanceBuf: DynamicInstanceBuffer;
  private shockwaveCount = 0;

  private active: ActiveShockwave[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(
    private gl: WebGL2RenderingContext,
    private settings: RenderSettings,
  ) {
    this.program = createProgram(gl, shockwaveVertSrc, shockwaveFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uRingWidth = gl.getUniformLocation(this.program, "uRingWidth")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;

    // Instanced geometry: 1 full-quad per shockwave ring
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Unit quad at location 0 (stride 8, non-instanced)
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      64,
      SHOCKWAVE_FLOATS,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceGlBuf);

    // Location 1..11: Per-instance shockwave attributes (divisor 1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SHOCKWAVE_STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 16);
    gl.vertexAttribDivisor(2, 1);

    for (let c = 0; c < MAX_NUKE_EXPLOSION_COLORS; c++) {
      const loc = 3 + c;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(
        loc,
        3,
        gl.FLOAT,
        false,
        SHOCKWAVE_STRIDE,
        20 + c * 12,
      );
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 68);
    gl.vertexAttribDivisor(7, 1);

    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 72);
    gl.vertexAttribDivisor(8, 1);

    gl.enableVertexAttribArray(9);
    gl.vertexAttribPointer(9, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 76);
    gl.vertexAttribDivisor(9, 1);

    gl.enableVertexAttribArray(10);
    gl.vertexAttribPointer(10, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 80);
    gl.vertexAttribDivisor(10, 1);

    gl.enableVertexAttribArray(11);
    gl.vertexAttribPointer(11, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 84);
    gl.vertexAttribDivisor(11, 1);

    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  // params = the firing player's resolved nuke-explosion cosmetic (undefined =
  // no cosmetic → default purple, default radius/speed).
  pushNukeShockwave(
    x: number,
    y: number,
    nukeRadius: number,
    params?: NukeExplosionRenderParams,
  ): void {
    const fx = this.settings.fx;
    const durationMs = calculateExplosionDurationMs(
      params,
      fx.nukeShockwaveDurationMs,
    );
    const speed = fx.nukeShockwaveDurationMs / durationMs;

    let cell = 0;
    if (params?.type === "sparkles" || params?.type === "embers") {
      const rawDensity = params.density ?? 50;
      const density = Math.min(
        Math.max(Number.isFinite(rawDensity) ? rawDensity : 50, 2),
        5000,
      );
      if (params.type === "sparkles") {
        cell = Math.sqrt((2 * Math.PI) / 3 / density);
      } else {
        // Embers reuse `cell` as the keep-fraction: the shader lights up that
        // share of grid cells, so a higher density gives a denser scatter.
        cell = Math.min(Math.max(density / 500, 0.04), 0.6);
      }
    }
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs,
      // Cosmetic maxRadius is absolute (world tiles); the default look scales
      // with the bomb's blast radius.
      maxRadius: params?.maxRadius ?? nukeRadius * fx.nukeShockwaveRadiusFactor,
      // Cosmetic type → its style; no cosmetic → classic ring (the original
      // nuke look).
      style: params
        ? params.type === "sparkles"
          ? 2
          : params.type === "embers"
            ? 3
            : 1
        : 0,
      colors: params?.colors ?? [DEFAULT_NUKE_EXPLOSION_COLOR],
      speed,
      transitionSpeed: params?.transitionSpeed ?? 0,
      thickness: params?.thickness ?? fx.shockwaveRingWidth ?? 4.0,
      cell,
    });
  }

  pushSAMShockwave(x: number, y: number): void {
    const fx = this.settings.fx;
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs: fx.samShockwaveDurationMs,
      maxRadius: fx.samShockwaveRadius,
      style: 0, // SAM interception keeps the classic ring
      colors: [WHITE],
      speed: 1,
      transitionSpeed: 0,
      thickness: 0, // classic style uses uRingWidth
      cell: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.active.length === 0) return;
    const now = this.timeFn();

    for (let i = this.active.length - 1; i >= 0; i--) {
      if (now - this.active[i].startMs >= this.active[i].durationMs) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    this.rebuildInstances(now);
  }

  private rebuildInstances(now: number): void {
    const count = this.active.length;
    this.instanceBuf.ensureCapacity(count);

    const data = this.instanceBuf.float32;
    for (let i = 0; i < count; i++) {
      const sw = this.active[i];
      const t = (now - sw.startMs) / sw.durationMs;
      const off = i * SHOCKWAVE_FLOATS;
      data[off + 0] = sw.x;
      data[off + 1] = sw.y;
      data[off + 2] = t * sw.maxRadius;
      data[off + 3] = 1 - t;
      data[off + 4] = sw.style;
      // Pad unused slots with the last palette color (see layout note above).
      for (let j = 0; j < MAX_NUKE_EXPLOSION_COLORS; j++) {
        const c = sw.colors[Math.min(j, sw.colors.length - 1)];
        const co = off + 5 + j * 3;
        data[co] = c[0];
        data[co + 1] = c[1];
        data[co + 2] = c[2];
      }
      data[off + 17] = Math.min(sw.colors.length, MAX_NUKE_EXPLOSION_COLORS);
      data[off + 18] = sw.speed;
      data[off + 19] = sw.transitionSpeed;
      data[off + 20] = sw.thickness;
      data[off + 21] = sw.cell;
    }

    this.shockwaveCount = count;
  }

  // -------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array): void {
    if (this.shockwaveCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uRingWidth, this.settings.fx.shockwaveRingWidth);
    gl.uniform1f(this.uTime, this.timeFn() * 0.001);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.shockwaveCount * SHOCKWAVE_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.shockwaveCount);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
  }

  clear(): void {
    this.active.length = 0;
    this.shockwaveCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadVbo);
  }
}
