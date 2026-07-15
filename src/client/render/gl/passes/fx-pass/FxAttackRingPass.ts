/**
 * FxAttackRingPass — persistent animated rings at transport ship target tiles.
 *
 * Rings fade in when a transport acquires a target, and fade out when the
 * target is lost. Uses a rotating dashed-ring shader (attack-ring.vert/frag).
 */

import type { AttackRingInput } from "../../../types";
import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import attackRingFragSrc from "../../shaders/fx/attack-ring.frag.glsl?raw";
import attackRingVertSrc from "../../shaders/fx/attack-ring.vert.glsl?raw";

export type { AttackRingInput } from "../../../types";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

interface ActiveAttackRing {
  unitId: number;
  x: number;
  y: number;
  /** performance.now() when fade-in started or fade-out began. */
  transitionMs: number;
  fadingOut: boolean;
}

// ---------------------------------------------------------------------------
// Instance data layout: x, y, alpha
// ---------------------------------------------------------------------------

const ATTACK_RING_FLOATS = 3;

const FADE_IN_MS = 200;
const FADE_OUT_MS = 300;

// ---------------------------------------------------------------------------
// FxAttackRingPass
// ---------------------------------------------------------------------------

export class FxAttackRingPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uTilesPerPx: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uRingWidth: WebGLUniformLocation;
  private uRingScreenPx: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private ringCount = 0;

  private active: ActiveAttackRing[] = [];

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    this.program = createProgram(gl, attackRingVertSrc, attackRingFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTilesPerPx = gl.getUniformLocation(this.program, "uTilesPerPx")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uRingWidth = gl.getUniformLocation(this.program, "uRingWidth")!;
    this.uRingScreenPx = gl.getUniformLocation(this.program, "uRingScreenPx")!;

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      8,
      ATTACK_RING_FLOATS,
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
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(rings: AttackRingInput[]): void {
    const now = performance.now();
    const incoming = new Set<number>();
    for (const r of rings) incoming.add(r.unitId);

    // Mark removed rings as fading out
    for (const ar of this.active) {
      if (!ar.fadingOut && !incoming.has(ar.unitId)) {
        ar.fadingOut = true;
        ar.transitionMs = now;
      }
    }

    // Add or refresh rings
    for (const r of rings) {
      const existing = this.active.find((a) => a.unitId === r.unitId);
      if (existing) {
        existing.x = r.x;
        existing.y = r.y;
        if (existing.fadingOut) {
          existing.fadingOut = false;
          existing.transitionMs = now;
        }
      } else {
        this.active.push({
          unitId: r.unitId,
          x: r.x,
          y: r.y,
          transitionMs: now,
          fadingOut: false,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.active.length === 0) return;
    const now = performance.now();

    // Remove fully faded rings
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ar = this.active[i];
      if (ar.fadingOut && now - ar.transitionMs >= FADE_OUT_MS) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    const count = this.active.length;
    this.instanceBuf.ensureCapacity(count);

    const data = this.instanceBuf.float32;
    for (let i = 0; i < count; i++) {
      const ar = this.active[i];
      const elapsed = now - ar.transitionMs;
      const alpha = ar.fadingOut
        ? Math.max(0, 1 - elapsed / FADE_OUT_MS)
        : Math.min(1, elapsed / FADE_IN_MS);
      const off = i * ATTACK_RING_FLOATS;
      data[off + 0] = ar.x;
      data[off + 1] = ar.y;
      data[off + 2] = alpha;
    }

    this.ringCount = count;
  }

  // -------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.ringCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTilesPerPx, 1 / zoom);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uRingWidth, this.settings.fx.shockwaveRingWidth);
    gl.uniform1f(this.uRingScreenPx, this.settings.fx.attackRingScreenPx);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.ringCount * ATTACK_RING_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.ringCount);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  clear(): void {
    this.active.length = 0;
    this.ringCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
