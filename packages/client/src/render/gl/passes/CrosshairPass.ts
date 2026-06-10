/**
 * CrosshairPass — renders a red crosshair at the cursor position during
 * warship or MIRV placement (ghost preview).
 *
 * Screen-space quad with a crosshair SDF in the fragment shader.
 * Darker red when placement is invalid.
 */

import type { GhostPreviewData } from "../../types";
import { UT_MIRV, UT_WARSHIP } from "../../types";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/crosshair/crosshair.frag.glsl?raw";
import vertSrc from "../shaders/crosshair/crosshair.vert.glsl?raw";

/** Half-size of the crosshair quad in screen pixels. */
const CROSSHAIR_PX = 20;

export class CrosshairPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;

  private active = false;
  private centerX = 0;
  private centerY = 0;
  private canBuild = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uHalfSize = gl.getUniformLocation(this.program, "uHalfSize")!;
    this.uViewport = gl.getUniformLocation(this.program, "uViewport")!;
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

  updateGhostPreview(data: GhostPreviewData | null): void {
    if (data && (data.ghostType === UT_WARSHIP || data.ghostType === UT_MIRV)) {
      this.active = true;
      this.centerX = data.tileX;
      this.centerY = data.tileY;
      this.canBuild = data.canBuild || data.canUpgrade;
    } else {
      this.active = false;
    }
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.active) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uCenter, this.centerX, this.centerY);
    gl.uniform1f(this.uHalfSize, CROSSHAIR_PX);
    gl.uniform2f(this.uViewport, gl.drawingBufferWidth, gl.drawingBufferHeight);

    if (this.canBuild) {
      gl.uniform3f(this.uColor, 0.9, 0.15, 0.15); // red crosshair
    } else {
      gl.uniform3f(this.uColor, 0.4, 0.1, 0.1); // dark red = can't build
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
