/**
 * TileScatterPass — GPU-side scatter writes into the R16UI tile texture.
 *
 * Replaces per-frame texSubImage2D bbox uploads with a single small attribute
 * buffer upload + one POINTS draw call into an FBO bound to tileTex. Constant
 * cost in the number of dirty tiles regardless of their spatial distribution —
 * unlike row-range uploads, which scale with the bounding box of dirty rows.
 *
 * Per-patch CPU cost is ~12 bytes (3 floats: x, y, state). Per draw call cost
 * is fixed regardless of patch count.
 */

import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/map-overlay/tile-scatter.frag.glsl?raw";
import vertSrc from "../shaders/map-overlay/tile-scatter.vert.glsl?raw";

const FLOATS_PER_PATCH = 3;
const INITIAL_CAPACITY = 4096;

export class TileScatterPass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uMapSize: WebGLUniformLocation;

  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;

  /** CPU-side patch buffer: [x, y, state, x, y, state, …]. */
  private patchData: Float32Array;
  private patchCount = 0;
  private patchCapacity = INITIAL_CAPACITY;
  /** GPU buffer byte capacity — grown via bufferData when exceeded. */
  private gpuCapacityBytes = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;

    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;

    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tileTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_PATCH * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
    gl.bindVertexArray(null);

    this.patchData = new Float32Array(INITIAL_CAPACITY * FLOATS_PER_PATCH);
  }

  /** Queue one tile patch. */
  push(x: number, y: number, state: number): void {
    if (this.patchCount >= this.patchCapacity) this.grow();
    const p = this.patchCount * FLOATS_PER_PATCH;
    this.patchData[p] = x;
    this.patchData[p + 1] = y;
    this.patchData[p + 2] = state;
    this.patchCount++;
  }

  get count(): number {
    return this.patchCount;
  }

  /** Drop any pending patches without writing (used on seek / full upload). */
  clear(): void {
    this.patchCount = 0;
  }

  /** Upload patches and run the scatter draw. Resets the queue. */
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);

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
