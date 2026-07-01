/**
 * FxShockwavePass — instanced procedural ring quads.
 *
 * Spawned alongside sprite FX for nuke and SAM interception events.
 * Uses an SDF circle rendered in a unit quad, no texture required.
 */

import type { NukeExplosionRenderParams } from "../../../types";
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import shockwaveFragSrc from "../../shaders/fx/shockwave.frag.glsl?raw";
import shockwaveVertSrc from "../../shaders/fx/shockwave.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];

// Default nuke shockwave (no cosmetic): purple, static, no color cross-fade.
const DEFAULT_NUKE_COLOR: RGB = [0.6, 0.1, 1];
// SAM interception keeps the classic white ring (color fields go unused there).
const WHITE: RGB = [1, 1, 1];

interface ActiveShockwave {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
  maxRadius: number;
  style: number; // 0 = classic ring (SAM + no-cosmetic nuke), 1 = EMP
  color0: RGB;
  color1: RGB;
  speed: number; // animation-speed multiplier
  transitionSpeed: number; // color0↔color1 cross-fade rate (Hz)
}

// ---------------------------------------------------------------------------
// Instance data layout (13 floats):
//   x, y, radius, alpha, style, color0.rgb, color1.rgb, speed, transitionSpeed
// ---------------------------------------------------------------------------

const SHOCKWAVE_FLOATS = 13;
const SHOCKWAVE_STRIDE = SHOCKWAVE_FLOATS * 4; // bytes

// ---------------------------------------------------------------------------
// FxShockwavePass
// ---------------------------------------------------------------------------

export class FxShockwavePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uRingWidth: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private shockwaveCount = 0;

  private active: ActiveShockwave[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    this.program = createProgram(gl, shockwaveVertSrc, shockwaveFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uRingWidth = gl.getUniformLocation(this.program, "uRingWidth")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      16,
      SHOCKWAVE_FLOATS,
    );

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    // location 1: x, y, radius, alpha
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SHOCKWAVE_STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);
    // location 2: style (0 classic, 1 EMP)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 16);
    gl.vertexAttribDivisor(2, 1);
    // location 3: color0 rgb
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, SHOCKWAVE_STRIDE, 20);
    gl.vertexAttribDivisor(3, 1);
    // location 4: color1 rgb
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, SHOCKWAVE_STRIDE, 32);
    gl.vertexAttribDivisor(4, 1);
    // location 5: speed
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 44);
    gl.vertexAttribDivisor(5, 1);
    // location 6: transitionSpeed
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 48);
    gl.vertexAttribDivisor(6, 1);

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
    const radiusFactor = params?.radiusFactor ?? fx.nukeShockwaveRadiusFactor;
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs: fx.nukeShockwaveDurationMs,
      maxRadius: nukeRadius * radiusFactor,
      // Cosmetic → EMP; no cosmetic → classic ring (the original nuke look).
      style: params ? 1 : 0,
      color0: params?.color0 ?? DEFAULT_NUKE_COLOR,
      color1: params?.color1 ?? DEFAULT_NUKE_COLOR,
      speed: params?.speed ?? 1,
      transitionSpeed: params?.transitionSpeed ?? 0,
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
      color0: WHITE,
      color1: WHITE,
      speed: 1,
      transitionSpeed: 0,
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
      data[off + 5] = sw.color0[0];
      data[off + 6] = sw.color0[1];
      data[off + 7] = sw.color0[2];
      data[off + 8] = sw.color1[0];
      data[off + 9] = sw.color1[1];
      data[off + 10] = sw.color1[2];
      data[off + 11] = sw.speed;
      data[off + 12] = sw.transitionSpeed;
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
  }
}
