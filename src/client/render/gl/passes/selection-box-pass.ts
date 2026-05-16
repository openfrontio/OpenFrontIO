/**
 * SelectionBoxPass — draws a stippled pulsating square border around a
 * selected warship, matching the game's native UILayer selection box.
 *
 * Single quad with tile-space SDF logic in the fragment shader.
 * Active only when a unit is selected via setSelectedUnit().
 */

import { createProgram } from "../utils/gl-utils";

import fragSrc from "../shaders/selection-box/selection-box.frag.glsl?raw";
import vertSrc from "../shaders/selection-box/selection-box.vert.glsl?raw";

/** Half-size of the selection box in tiles (matches game's SELECTION_BOX_SIZE). */
const HALF_SIZE = 6;

export class SelectionBoxPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;

  private active = false;
  private centerX = 0;
  private centerY = 0;
  private colorR = 1;
  private colorG = 1;
  private colorB = 1;

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
   * Set the selection box center and color. Pass active=false to hide.
   */
  update(
    active: boolean,
    centerX: number,
    centerY: number,
    r: number,
    g: number,
    b: number,
  ): void {
    this.active = active;
    this.centerX = centerX;
    this.centerY = centerY;
    this.colorR = r;
    this.colorG = g;
    this.colorB = b;
  }

  hide(): void {
    this.active = false;
  }

  draw(cameraMatrix: Float32Array, frameTick: number): void {
    if (!this.active) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uCenter, this.centerX, this.centerY);
    gl.uniform1f(this.uHalfSize, HALF_SIZE);
    gl.uniform1f(this.uTime, frameTick);
    gl.uniform3f(this.uColor, this.colorR, this.colorG, this.colorB);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
