/**
 * FxShockwavePass — instanced procedural ring quads.
 *
 * Spawned alongside sprite FX for nuke and SAM interception events.
 * Uses an SDF circle rendered in a unit quad, no texture required.
 */

import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import shockwaveFragSrc from "../../shaders/fx/shockwave.frag.glsl?raw";
import shockwaveVertSrc from "../../shaders/fx/shockwave.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

interface ActiveShockwave {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
  maxRadius: number;
  isNuke: boolean;
}

// ---------------------------------------------------------------------------
// Instance data layout: x, y, radius, alpha, isNuke
// ---------------------------------------------------------------------------

const SHOCKWAVE_FLOATS = 5;
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
  private uNukeStyle: WebGLUniformLocation;
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
    this.uNukeStyle = gl.getUniformLocation(this.program, "uNukeStyle")!;

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
    // location 2: isNuke flag
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, SHOCKWAVE_STRIDE, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  pushNukeShockwave(x: number, y: number, nukeRadius: number): void {
    const fx = this.settings.fx;
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs: fx.nukeShockwaveDurationMs,
      maxRadius: nukeRadius * fx.nukeShockwaveRadiusFactor,
      isNuke: true,
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
      isNuke: false,
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
      data[off + 4] = sw.isNuke ? 1 : 0;
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
    gl.uniform1i(this.uNukeStyle, this.settings.fx.nukeShockwaveStyle);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.shockwaveCount * SHOCKWAVE_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    // Additive blending gives the energy pulse its electric glow. Restore the
    // renderer's standard alpha blend afterward so later passes composite normally.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.shockwaveCount);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
