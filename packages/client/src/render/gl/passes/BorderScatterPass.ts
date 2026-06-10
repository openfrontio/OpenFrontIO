/**
 * BorderScatterPass — incremental GPU border recompute for tiles that changed.
 *
 * Companion to BorderComputePass. The full-screen pass in BorderComputePass
 * runs the same fragment shader over every tile in the map every time the
 * border buffer is invalidated; for per-frame tile flips that scales linearly
 * with map area (O(mapW × mapH)). This pass shares the same fragment shader
 * but rasterizes only one POINT per dirty tile — cost is O(dirty patches)
 * regardless of distribution.
 *
 * Each tile change requires recomputing the border value at the changed tile
 * plus its 4 cardinal neighbors, because the cardinal-neighbor test in the
 * border shader makes the neighbors' results depend on this tile's ownership.
 * Use `pushWithNeighbors` to do that expansion automatically.
 *
 * Highlight-thicken rings within `uHighlightThicken` of a changed tile are
 * NOT incrementally repainted — they'll lag visually until the next full
 * recompute (which fires on highlight / relation / defense changes). That
 * artifact is small and short-lived; for live combat it's a fair trade.
 */

import type { RenderSettings } from "../RenderSettings";
import { createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import borderComputeFragSrc from "../shaders/border-compute/border-compute.frag.glsl?raw";
import borderScatterVertSrc from "../shaders/border-compute/border-scatter.vert.glsl?raw";

const FLOATS_PER_PATCH = 2;
const INITIAL_CAPACITY = 4096;

export class BorderScatterPass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private mapH: number;
  private settings: RenderSettings;
  private tileTex: WebGLTexture;
  private relationTex: WebGLTexture;

  private program: WebGLProgram;
  private uMapSize: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightThicken: WebGLUniformLocation;

  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;

  // Mirrored from BorderComputePass — set via setters when those change.
  private highlightOwner = 0;

  /** CPU-side patch buffer: [x, y, x, y, …]. */
  private patchData: Float32Array;
  private patchCount = 0;
  private patchCapacity = INITIAL_CAPACITY;
  private gpuCapacityBytes = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    borderTex: WebGLTexture,
    tileTex: WebGLTexture,
    relationTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.settings = settings;
    this.tileTex = tileTex;
    this.relationTex = relationTex;

    this.program = createProgram(
      gl,
      borderScatterVertSrc,
      shaderSrc(borderComputeFragSrc, { ...TILE_DEFINES }),
    );

    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uHighlightOwner = gl.getUniformLocation(
      this.program,
      "uHighlightOwner",
    )!;
    this.uHighlightThicken = gl.getUniformLocation(
      this.program,
      "uHighlightThicken",
    )!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uRelationTex"), 1);

    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      borderTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_PATCH * 4, 0);
    gl.bindVertexArray(null);

    this.patchData = new Float32Array(INITIAL_CAPACITY * FLOATS_PER_PATCH);
  }

  /** Queue one tile coordinate. */
  push(x: number, y: number): void {
    if (this.patchCount >= this.patchCapacity) this.grow();
    const p = this.patchCount * FLOATS_PER_PATCH;
    this.patchData[p] = x;
    this.patchData[p + 1] = y;
    this.patchCount++;
  }

  /** Queue the tile + its 4 cardinal neighbors (clipped to map bounds). */
  pushWithNeighbors(x: number, y: number): void {
    this.push(x, y);
    if (x > 0) this.push(x - 1, y);
    if (x < this.mapW - 1) this.push(x + 1, y);
    if (y > 0) this.push(x, y - 1);
    if (y < this.mapH - 1) this.push(x, y + 1);
  }

  get count(): number {
    return this.patchCount;
  }

  clear(): void {
    this.patchCount = 0;
  }

  setHighlightOwner(owner: number): void {
    this.highlightOwner = owner;
  }

  flush(): void {
    if (this.patchCount === 0) return;
    const gl = this.gl;

    const floats = this.patchCount * FLOATS_PER_PATCH;
    const byteCount = floats * 4;
    const view = this.patchData.subarray(0, floats);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (byteCount > this.gpuCapacityBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, view, gl.STREAM_DRAW);
      this.gpuCapacityBytes = byteCount;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
    }

    const mo = this.settings.mapOverlay;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1i(this.uHighlightThicken, Math.floor(mo.highlightThicken));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.relationTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.patchCount);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.patchCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
  }

  private grow(): void {
    const newCapacity = this.patchCapacity * 2;
    const newBuf = new Float32Array(newCapacity * FLOATS_PER_PATCH);
    newBuf.set(this.patchData);
    this.patchData = newBuf;
    this.patchCapacity = newCapacity;
  }
}
