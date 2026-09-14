/**
 * NukeTrajectoryPass — renders the nuke trajectory preview arc during
 * build mode (Atom Bomb / Hydrogen Bomb ghost active).
 *
 * Renders as a triangle strip with screen-space line width. The cubic
 * Bezier is evaluated on the GPU from 4 control-point uniforms; cumulative
 * arc distances are pre-computed on the CPU for accurate pixel-space dashing.
 *
 * Zone boundary circles and SAM intercept X markers are drawn with a
 * separate marker program.
 */

import type { NukeTrajectoryData } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import markerFragSrc from "../shaders/nuke-trajectory/nuke-trajectory-marker.frag.glsl?raw";
import markerVertSrc from "../shaders/nuke-trajectory/nuke-trajectory-marker.vert.glsl?raw";
import fragSrc from "../shaders/nuke-trajectory/nuke-trajectory.frag.glsl?raw";
import vertSrc from "../shaders/nuke-trajectory/nuke-trajectory.vert.glsl?raw";

const NUM_SEGMENTS = 128;
const VERTS_PER_PAIR = 2;
const FLOATS_PER_VERT = 3; // (t, side, cumDist)

export class NukeTrajectoryPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  // Line program
  private lineProgram: WebGLProgram;
  private lineVAO: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineVertexCount: number;
  private lineVertices: Float32Array;
  private uLineCamera: WebGLUniformLocation;
  private uLineP0: WebGLUniformLocation;
  private uLineP1: WebGLUniformLocation;
  private uLineP2: WebGLUniformLocation;
  private uLineP3: WebGLUniformLocation;
  private uLinePixelSize: WebGLUniformLocation;
  private uLineTUntargetableStart: WebGLUniformLocation;
  private uLineTUntargetableEnd: WebGLUniformLocation;
  private uLineTSamIntercept: WebGLUniformLocation;
  private uLineQuadHalfPx: WebGLUniformLocation;
  private uLineLineHalfPx: WebGLUniformLocation;
  private uLineOutlineHalfPx: WebGLUniformLocation;
  private uLineDashPattern: WebGLUniformLocation;
  private uLineLineColor: WebGLUniformLocation;
  private uLineInterceptColor: WebGLUniformLocation;
  private uLineOutlineColor: WebGLUniformLocation;
  private uLineInterceptOutlineColor: WebGLUniformLocation;

  // Marker program
  private markerProgram: WebGLProgram;
  private markerVAO: WebGLVertexArrayObject;
  private uMarkerCamera: WebGLUniformLocation;
  private uMarkerP0: WebGLUniformLocation;
  private uMarkerP1: WebGLUniformLocation;
  private uMarkerP2: WebGLUniformLocation;
  private uMarkerP3: WebGLUniformLocation;
  private uMarkerPixelSize: WebGLUniformLocation;
  private uMarker: WebGLUniformLocation;
  private uMarkerRadii: WebGLUniformLocation;

  private visible = false;
  private data: NukeTrajectoryData | null = null;

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    // --- Line program ---
    this.lineProgram = createProgram(gl, vertSrc, fragSrc);
    this.uLineCamera = gl.getUniformLocation(this.lineProgram, "uCamera")!;
    this.uLineP0 = gl.getUniformLocation(this.lineProgram, "uP0")!;
    this.uLineP1 = gl.getUniformLocation(this.lineProgram, "uP1")!;
    this.uLineP2 = gl.getUniformLocation(this.lineProgram, "uP2")!;
    this.uLineP3 = gl.getUniformLocation(this.lineProgram, "uP3")!;
    this.uLinePixelSize = gl.getUniformLocation(
      this.lineProgram,
      "uPixelSize",
    )!;
    this.uLineTUntargetableStart = gl.getUniformLocation(
      this.lineProgram,
      "uTUntargetableStart",
    )!;
    this.uLineTUntargetableEnd = gl.getUniformLocation(
      this.lineProgram,
      "uTUntargetableEnd",
    )!;
    this.uLineTSamIntercept = gl.getUniformLocation(
      this.lineProgram,
      "uTSamIntercept",
    )!;
    this.uLineQuadHalfPx = gl.getUniformLocation(
      this.lineProgram,
      "uQuadHalfPx",
    )!;
    this.uLineLineHalfPx = gl.getUniformLocation(
      this.lineProgram,
      "uLineHalfPx",
    )!;
    this.uLineOutlineHalfPx = gl.getUniformLocation(
      this.lineProgram,
      "uOutlineHalfPx",
    )!;
    this.uLineDashPattern = gl.getUniformLocation(
      this.lineProgram,
      "uDashPattern",
    )!;
    this.uLineLineColor = gl.getUniformLocation(
      this.lineProgram,
      "uLineColor",
    )!;
    this.uLineInterceptColor = gl.getUniformLocation(
      this.lineProgram,
      "uInterceptColor",
    )!;
    this.uLineOutlineColor = gl.getUniformLocation(
      this.lineProgram,
      "uOutlineColor",
    )!;
    this.uLineInterceptOutlineColor = gl.getUniformLocation(
      this.lineProgram,
      "uInterceptOutlineColor",
    )!;

    // Triangle strip: (N+1) pairs of left/right vertices
    const N = NUM_SEGMENTS;
    this.lineVertexCount = (N + 1) * VERTS_PER_PAIR;
    this.lineVertices = new Float32Array(
      this.lineVertexCount * FLOATS_PER_VERT,
    );

    this.lineVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVAO);
    this.lineBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.lineVertices.byteLength,
      gl.DYNAMIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // --- Marker program ---
    this.markerProgram = createProgram(gl, markerVertSrc, markerFragSrc);
    this.uMarkerCamera = gl.getUniformLocation(this.markerProgram, "uCamera")!;
    this.uMarkerP0 = gl.getUniformLocation(this.markerProgram, "uP0")!;
    this.uMarkerP1 = gl.getUniformLocation(this.markerProgram, "uP1")!;
    this.uMarkerP2 = gl.getUniformLocation(this.markerProgram, "uP2")!;
    this.uMarkerP3 = gl.getUniformLocation(this.markerProgram, "uP3")!;
    this.uMarkerPixelSize = gl.getUniformLocation(
      this.markerProgram,
      "uPixelSize",
    )!;
    this.uMarker = gl.getUniformLocation(this.markerProgram, "uMarker")!;
    this.uMarkerRadii = gl.getUniformLocation(
      this.markerProgram,
      "uMarkerRadii",
    )!;

    this.markerVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.markerVAO);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  update(data: NukeTrajectoryData | null): void {
    this.data = data;
    this.visible = data !== null;
    if (data) this.rebuildVertices(data);
  }

  /** Recompute triangle strip vertices with cumulative arc distances. */
  private rebuildVertices(d: NukeTrajectoryData): void {
    const N = NUM_SEGMENTS;
    const buf = this.lineVertices;
    let cumDist = 0;
    let prevX = d.p0x;
    let prevY = d.p0y;

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const T = 1 - t;
      const TT = T * T;
      const tt = t * t;
      const x =
        TT * T * d.p0x +
        3 * TT * t * d.p1x +
        3 * T * tt * d.p2x +
        tt * t * d.p3x;
      const y =
        TT * T * d.p0y +
        3 * TT * t * d.p1y +
        3 * T * tt * d.p2y +
        tt * t * d.p3y;

      if (i > 0) {
        const dx = x - prevX;
        const dy = y - prevY;
        cumDist += Math.sqrt(dx * dx + dy * dy);
      }
      prevX = x;
      prevY = y;

      const idx = i * VERTS_PER_PAIR * FLOATS_PER_VERT;
      buf[idx + 0] = t;
      buf[idx + 1] = -1;
      buf[idx + 2] = cumDist;
      buf[idx + 3] = t;
      buf[idx + 4] = 1;
      buf[idx + 5] = cumDist;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.visible || !this.data) return;

    const gl = this.gl;
    const d = this.data;
    const s = this.settings.nukeTrajectory;
    const pixelSize = 2.0 / (cameraMatrix[0] * gl.drawingBufferWidth);

    // Derived pixel dimensions
    const lineHalfPx = s.lineWidth / 2;
    const outlineHalfPx = (s.lineWidth + s.outlineWidth) / 2;
    const quadHalfPx = outlineHalfPx + 1.0; // AA padding

    // --- Draw trajectory line ---
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix3fv(this.uLineCamera, false, cameraMatrix);
    gl.uniform2f(this.uLineP0, d.p0x, d.p0y);
    gl.uniform2f(this.uLineP1, d.p1x, d.p1y);
    gl.uniform2f(this.uLineP2, d.p2x, d.p2y);
    gl.uniform2f(this.uLineP3, d.p3x, d.p3y);
    gl.uniform1f(this.uLinePixelSize, pixelSize);
    gl.uniform1f(this.uLineTUntargetableStart, d.tUntargetableStart);
    gl.uniform1f(this.uLineTUntargetableEnd, d.tUntargetableEnd);
    gl.uniform1f(this.uLineTSamIntercept, d.tSamIntercept);
    gl.uniform1f(this.uLineQuadHalfPx, quadHalfPx);
    gl.uniform1f(this.uLineLineHalfPx, lineHalfPx);
    gl.uniform1f(this.uLineOutlineHalfPx, outlineHalfPx);
    gl.uniform4f(
      this.uLineDashPattern,
      s.dashTargetable,
      s.gapTargetable,
      s.dashUntargetable,
      s.gapUntargetable,
    );
    gl.uniform3f(this.uLineLineColor, s.lineR, s.lineG, s.lineB);
    gl.uniform3f(
      this.uLineInterceptColor,
      s.interceptR,
      s.interceptG,
      s.interceptB,
    );
    gl.uniform3f(this.uLineOutlineColor, s.outlineR, s.outlineG, s.outlineB);
    gl.uniform3f(
      this.uLineInterceptOutlineColor,
      s.interceptOutlineR,
      s.interceptOutlineG,
      s.interceptOutlineB,
    );

    gl.bindVertexArray(this.lineVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.lineVertexCount);

    // --- Draw markers ---
    this.drawMarkers(cameraMatrix, d, pixelSize);
  }

  private drawMarkers(
    cameraMatrix: Float32Array,
    d: NukeTrajectoryData,
    pixelSize: number,
  ): void {
    const markers: [number, number][] = [];
    if (d.tUntargetableStart >= 0) {
      markers.push([d.tUntargetableStart, 0]);
      markers.push([d.tUntargetableEnd, 0]);
    }
    if (d.tSamIntercept < 1.0) {
      markers.push([d.tSamIntercept, 1]);
    }
    if (markers.length === 0) return;

    const gl = this.gl;
    const s = this.settings.nukeTrajectory;
    gl.useProgram(this.markerProgram);
    gl.uniformMatrix3fv(this.uMarkerCamera, false, cameraMatrix);
    gl.uniform2f(this.uMarkerP0, d.p0x, d.p0y);
    gl.uniform2f(this.uMarkerP1, d.p1x, d.p1y);
    gl.uniform2f(this.uMarkerP2, d.p2x, d.p2y);
    gl.uniform2f(this.uMarkerP3, d.p3x, d.p3y);
    gl.uniform1f(this.uMarkerPixelSize, pixelSize);
    gl.uniform2f(this.uMarkerRadii, s.markerCircleRadius, s.markerXRadius);

    gl.bindVertexArray(this.markerVAO);
    for (const [t, type] of markers) {
      gl.uniform4f(this.uMarker, t, type, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.lineProgram);
    gl.deleteProgram(this.markerProgram);
    gl.deleteVertexArray(this.lineVAO);
    gl.deleteVertexArray(this.markerVAO);
  }
}
