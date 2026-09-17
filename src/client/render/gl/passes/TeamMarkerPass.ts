/**
 * TeamMarkerPass — a pulsing four-point star over each teammate's spawn
 * during the spawn phase of team games, so allies stand out on the map
 * regardless of zoom. Screen-anchored: the star keeps a constant pixel size.
 * One instanced quad per teammate; a no-op when there are none.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/team-marker/team-marker.frag.glsl?raw";
import vertSrc from "../shaders/team-marker/team-marker.vert.glsl?raw";

// Per-instance: x, y, r, g, b
const FLOATS_PER_INSTANCE = 5;
/** Half-size of the star quad in screen pixels at the peak of the pulse. */
const MARKER_HALF_PX = 34;
const PULSE_SPEED = 0.0025; // radians per ms
/**
 * Zoom (pixels per tile) band over which the stars fade out. Zoomed in past
 * this a teammate's spawn is plainly visible on its own, and a screen-sized
 * star would just cover it.
 */
const FADE_START_ZOOM = 3;
const FADE_END_ZOOM = 5;

export interface TeamMarker {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

export class TeamMarkerPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;

  private uCamera: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;

  private instanceCount = 0;
  private animTime = 0;
  private lastTime = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uHalfSize = gl.getUniformLocation(this.program, "uHalfSize")!;
    this.uViewport = gl.getUniformLocation(this.program, "uViewport")!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;

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

    // Instance buffer: [x, y, r, g, b]
    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      16,
      FLOATS_PER_INSTANCE,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    const stride = FLOATS_PER_INSTANCE * 4;

    // Attribute 1: per-instance vec2 (x, y)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    // Attribute 2: per-instance vec3 (r, g, b)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /** Replace the marker set. An empty list turns the pass off. */
  update(markers: TeamMarker[]): void {
    this.instanceCount = markers.length;
    if (markers.length === 0) return;

    this.instanceBuf.ensureCapacity(markers.length);
    const data = this.instanceBuf.float32;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const off = i * FLOATS_PER_INSTANCE;
      data[off + 0] = m.x;
      data[off + 1] = m.y;
      data[off + 2] = m.r;
      data[off + 3] = m.g;
      data[off + 4] = m.b;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      markers.length * FLOATS_PER_INSTANCE,
    );
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.instanceCount === 0) return;
    const zoomFade =
      1 -
      Math.min(
        1,
        Math.max(
          0,
          (zoom - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM),
        ),
      );
    if (zoomFade <= 0) return;

    const gl = this.gl;
    const now = performance.now();
    if (this.lastTime > 0) {
      // Clamp the delta so a backgrounded tab doesn't leap the pulse phase.
      this.animTime += Math.min(now - this.lastTime, 100) * PULSE_SPEED;
    }
    this.lastTime = now;
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    // Breathe: the star grows and brightens together, then eases back.
    gl.uniform1f(this.uHalfSize, MARKER_HALF_PX * (0.7 + 0.3 * pulse));
    gl.uniform1f(this.uAlpha, (0.55 + 0.45 * pulse) * zoomFade);
    gl.uniform2f(this.uViewport, gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
