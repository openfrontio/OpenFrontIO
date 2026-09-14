/**
 * SelectionBoxPass — draws stippled pulsating square borders around selected
 * warships. Supports any number of selections; renders one quad per selection.
 *
 * For typical use (1-50 selected units) the draw-call overhead is fine; if
 * this ever becomes hot we could swap to instanced rendering.
 */

import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/selection-box/selection-box.frag.glsl?raw";
import vertSrc from "../shaders/selection-box/selection-box.vert.glsl?raw";

/** Half-size of the selection box in tiles (matches game's SELECTION_BOX_SIZE). */
const HALF_SIZE = 6;

export interface SelectionEntry {
  centerX: number;
  centerY: number;
  r: number;
  g: number;
  b: number;
}

export class SelectionBoxPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;

  /** Reusable buffer of selections — caller mutates via setSelections(). */
  private readonly selections: SelectionEntry[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uHalfSize = gl.getUniformLocation(this.program, "uHalfSize")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;

    // Unit quad [0,1]
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
    gl.bindVertexArray(null);
  }

  /**
   * Replace the set of selections drawn this frame. Call with [] to hide.
   * Stored by reference — the renderer rebuilds the array each frame from
   * the current unit positions/colors, so we just swap pointers.
   */
  setSelections(entries: readonly SelectionEntry[]): void {
    this.selections.length = 0;
    for (let i = 0; i < entries.length; i++) {
      this.selections.push(entries[i]);
    }
  }

  /** Legacy single-selection API kept for callers that haven't migrated. */
  update(
    active: boolean,
    centerX: number,
    centerY: number,
    r: number,
    g: number,
    b: number,
  ): void {
    this.selections.length = 0;
    if (active) this.selections.push({ centerX, centerY, r, g, b });
  }

  hide(): void {
    this.selections.length = 0;
  }

  draw(cameraMatrix: Float32Array, frameTick: number): void {
    if (this.selections.length === 0) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uHalfSize, HALF_SIZE);
    gl.uniform1f(this.uTime, frameTick);
    gl.bindVertexArray(this.vao);

    // One draw call per selection — for the typical N=1..50, this is cheap.
    // (If profiling ever shows it matters, swap to instanced rendering with a
    // small per-instance VBO of {centerX, centerY, r, g, b}.)
    for (let i = 0; i < this.selections.length; i++) {
      const s = this.selections[i];
      gl.uniform2f(this.uCenter, s.centerX, s.centerY);
      gl.uniform3f(this.uColor, s.r, s.g, s.b);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
