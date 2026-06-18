/**
 * SpawnOverlayPass — spawn phase tile highlights + breathing rings.
 *
 * Active only during spawn phase. Renders:
 *   1. Colored highlights on unowned tiles within radius of each enemy human
 *      player's spawn center.
 *   2. Animated breathing rings around the local player and teammates.
 *
 * One instanced quad is drawn per spawn center (sized to that center's
 * influence radius), so cost scales with the number of spawns rather than
 * screen area — this supports the renderer's full player ceiling (~1024)
 * without the uniform-array limit or a per-pixel loop over every spawn.
 *
 * Instances are ordered enemies → teammates → self so that, under standard
 * over-blending, the local player's ring composites on top.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import spawnFragSrc from "../shaders/spawn-overlay/spawn-overlay.frag.glsl?raw";
import overlayVertSrc from "../shaders/spawn-overlay/spawn-overlay.vert.glsl?raw";

// Per-instance: centerX, centerY, quadRadius, kind, r, g, b
const FLOATS_PER_INSTANCE = 7;

// Quad must cover the ring at its largest breath expansion (scale tops out at
// 0.5 + 0.65 = 1.15), plus a margin so the antialiased edge isn't clipped.
const MAX_BREATH_SCALE = 1.15;
const RADIUS_MARGIN = 1;

// Instance kinds (must match spawn-overlay.frag.glsl).
const KIND_ENEMY = 0;
const KIND_SELF = 1;
const KIND_TEAMMATE = 2;

export interface SpawnCenter {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  isSelf: boolean;
  isTeammate: boolean;
}

export class SpawnOverlayPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private settings: RenderSettings["spawnOverlay"];

  // Uniforms
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uBreathRadius: WebGLUniformLocation;
  private uHighlightRadiusSq: WebGLUniformLocation;
  private uHighlightAlpha: WebGLUniformLocation;
  private uSelfRadii: WebGLUniformLocation;
  private uMateRadii: WebGLUniformLocation;
  private uGradientStops: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  // State
  private active = false;
  private instanceCount = 0;
  private animTime = 0;
  private lastTime = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings["spawnOverlay"],
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.settings = settings;

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(spawnFragSrc, { ...TILE_DEFINES }),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uBreathRadius = gl.getUniformLocation(this.program, "uBreathRadius")!;
    this.uHighlightRadiusSq = gl.getUniformLocation(
      this.program,
      "uHighlightRadiusSq",
    )!;
    this.uHighlightAlpha = gl.getUniformLocation(
      this.program,
      "uHighlightAlpha",
    )!;
    this.uSelfRadii = gl.getUniformLocation(this.program, "uSelfRadii")!;
    this.uMateRadii = gl.getUniformLocation(this.program, "uMateRadii")!;
    this.uGradientStops = gl.getUniformLocation(
      this.program,
      "uGradientStops",
    )!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,1] (two triangles)
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer: [x, y, radius, kind, r, g, b]
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      64,
      FLOATS_PER_INSTANCE,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    const stride = FLOATS_PER_INSTANCE * 4;

    // Attribute 1: per-instance vec4 (x, y, radius, kind)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec3 (r, g, b)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /** Update spawn overlay state each tick. */
  update(inSpawnPhase: boolean, centers: SpawnCenter[]): void {
    this.active = inSpawnPhase && centers.length > 0;
    if (!this.active) {
      this.instanceCount = 0;
      return;
    }

    const s = this.settings;
    const selfRadius = s.selfMaxRad * MAX_BREATH_SCALE + RADIUS_MARGIN;
    const mateRadius = s.mateMaxRad * MAX_BREATH_SCALE + RADIUS_MARGIN;
    const enemyRadius = s.highlightRadius + RADIUS_MARGIN;

    this.instanceBuf.ensureCapacity(centers.length);
    const data = this.instanceBuf.float32;
    let count = 0;

    const write = (c: SpawnCenter, kind: number, radius: number) => {
      const off = count * FLOATS_PER_INSTANCE;
      data[off + 0] = c.x;
      data[off + 1] = c.y;
      data[off + 2] = radius;
      data[off + 3] = kind;
      data[off + 4] = c.r;
      data[off + 5] = c.g;
      data[off + 6] = c.b;
      count++;
    };

    // Draw order = buffer order; over-blending puts later instances on top.
    // Enemies first, then teammates, then self so the local ring wins.
    for (const c of centers) {
      if (!c.isSelf && !c.isTeammate) write(c, KIND_ENEMY, enemyRadius);
    }
    for (const c of centers) {
      if (c.isTeammate) write(c, KIND_TEAMMATE, mateRadius);
    }
    for (const c of centers) {
      if (c.isSelf) write(c, KIND_SELF, selfRadius);
    }

    this.instanceCount = count;

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

  draw(cameraMatrix: Float32Array): void {
    if (!this.active || this.instanceCount === 0) return;

    const gl = this.gl;
    const s = this.settings;
    const now = performance.now();

    // Advance animation time
    if (this.lastTime > 0) {
      this.animTime += (now - this.lastTime) * s.animSpeed;
    }
    this.lastTime = now;

    const breathRadius = 0.5 + 0.5 * Math.sin(this.animTime);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uBreathRadius, breathRadius);

    // Settings-driven uniforms
    gl.uniform1f(
      this.uHighlightRadiusSq,
      s.highlightRadius * s.highlightRadius,
    );
    gl.uniform1f(this.uHighlightAlpha, s.highlightAlpha);
    gl.uniform4f(this.uSelfRadii, s.selfMinRad, s.selfMaxRad, 0, 0);
    gl.uniform4f(this.uMateRadii, s.mateMinRad, s.mateMaxRad, 0, 0);
    gl.uniform2f(this.uGradientStops, s.gradientInnerEdge, s.gradientSolidEnd);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
    // tileTex owned by GPUResources
  }
}
