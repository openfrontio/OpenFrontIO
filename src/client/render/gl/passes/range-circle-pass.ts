/**
 * RangeCirclePass — draws a translucent white circle showing the effective
 * range of a structure during build-mode ghost preview.
 *
 * Single quad with circle SDF in the fragment shader.
 * Active only when a ghost preview with rangeRadius > 0 is set.
 */

import type { GhostPreviewData } from "../../types";
import { createProgram } from "../utils/gl-utils";

import fragSrc from "../shaders/range-circle/range-circle.frag.glsl?raw";
import vertSrc from "../shaders/range-circle/range-circle.vert.glsl?raw";

export class RangeCirclePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;

  private centerX = 0;
  private centerY = 0;
  private radius = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;

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
    if (data && data.rangeRadius > 0) {
      this.centerX = data.tileX;
      this.centerY = data.tileY;
      this.radius = data.rangeRadius;
    } else {
      this.radius = 0;
    }
  }

  draw(cameraMatrix: Float32Array): void {
    if (this.radius <= 0) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uCenter, this.centerX, this.centerY);
    gl.uniform1f(this.uRadius, this.radius);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
