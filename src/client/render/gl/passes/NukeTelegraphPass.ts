/**
 * NukeTelegraphPass — renders animated blast-radius circles at the target
 * location of each in-flight nuke.
 *
 * Instanced quads with two concentric circle SDFs (inner filled, outer
 * dashed ring). Similar to SAMRadiusPass but with different aesthetics.
 */

import type { NukeTelegraphData } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/nuke-telegraph/nuke-telegraph.frag.glsl?raw";
import vertSrc from "../shaders/nuke-telegraph/nuke-telegraph.vert.glsl?raw";

// Per-instance: x, y, innerRadius, outerRadius, relation
const FLOATS_PER_INSTANCE = 5;

export class NukeTelegraphPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;

  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uTelegraphStyle: WebGLUniformLocation;
  private uTelegraphAlpha: WebGLUniformLocation;
  private uColorSelf: WebGLUniformLocation;
  private uColorAlly: WebGLUniformLocation;
  private uColorEnemy: WebGLUniformLocation;

  private instanceCount = 0;
  private startTime = performance.now();

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uTelegraphStyle = gl.getUniformLocation(
      this.program,
      "uTelegraphStyle",
    )!;
    this.uTelegraphAlpha = gl.getUniformLocation(
      this.program,
      "uTelegraphAlpha",
    )!;
    this.uColorSelf = gl.getUniformLocation(this.program, "uColorSelf")!;
    this.uColorAlly = gl.getUniformLocation(this.program, "uColorAlly")!;
    this.uColorEnemy = gl.getUniformLocation(this.program, "uColorEnemy")!;

    // VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec4 (x, y, innerR, outerR)
    // Attribute 2: per-instance float (relation: 0=self, 1=ally, 2=enemy)
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      16,
      FLOATS_PER_INSTANCE,
    );
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  update(data: NukeTelegraphData[]): void {
    const count = data.length;
    this.instanceBuf.ensureCapacity(count);

    const buf = this.instanceBuf.float32;
    for (let i = 0; i < count; i++) {
      const d = data[i];
      const off = i * FLOATS_PER_INSTANCE;
      buf[off + 0] = d.x;
      buf[off + 1] = d.y;
      buf[off + 2] = d.innerRadius;
      buf[off + 3] = d.outerRadius;
      buf[off + 4] = d.relation;
    }

    this.instanceCount = count;

    if (count > 0) {
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
  }

  draw(cameraMatrix: Float32Array): void {
    if (this.instanceCount === 0) return;

    const gl = this.gl;
    const s = this.settings.nukeTelegraph;
    const time = (performance.now() - this.startTime) / 1000;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, time);
    gl.uniform4f(
      this.uTelegraphStyle,
      s.strokeWidth,
      s.dashLen,
      s.gapLen,
      s.rotationSpeed,
    );
    gl.uniform4f(
      this.uTelegraphAlpha,
      s.baseAlpha,
      s.pulseAmplitude,
      s.pulseSpeed,
      s.fillAlphaOffset,
    );
    gl.uniform3f(this.uColorSelf, s.selfColorR, s.selfColorG, s.selfColorB);
    gl.uniform3f(this.uColorAlly, s.allyColorR, s.allyColorG, s.allyColorB);
    gl.uniform3f(this.uColorEnemy, s.colorR, s.colorG, s.colorB);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
