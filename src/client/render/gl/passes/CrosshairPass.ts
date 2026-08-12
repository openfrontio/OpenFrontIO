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

import statusAtlasUrl from "resources/atlases/status-atlas.png";

/** Half-size of the crosshair quad in screen pixels. */
const CROSSHAIR_PX = 20;
const QUAD_VERTS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);

export class CrosshairPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uViewport: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uIsDiagonal: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private uStatusAtlas: WebGLUniformLocation;
  private uHasAtlas: WebGLUniformLocation;

  private statusAtlasTex: WebGLTexture | null = null;

  private active = false;
  private centerX = 0;
  private centerY = 0;
  private canBuild = false;

  private blockedXTile: {
    x: number;
    y: number;
    startTime: number;
    duration: number;
  } | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uHalfSize = gl.getUniformLocation(this.program, "uHalfSize")!;
    this.uViewport = gl.getUniformLocation(this.program, "uViewport")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uIsDiagonal = gl.getUniformLocation(this.program, "uIsDiagonal")!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;
    this.uStatusAtlas = gl.getUniformLocation(this.program, "uStatusAtlas")!;
    this.uHasAtlas = gl.getUniformLocation(this.program, "uHasAtlas")!;

    const img = new Image();
    img.onload = () => {
      if (!this.gl) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.statusAtlasTex = tex;
    };
    img.src = statusAtlasUrl;

    // Unit quad [0,1]
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);

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

  triggerBlockedFlash(tileX: number, tileY: number): void {
    this.blockedXTile = {
      x: tileX,
      y: tileY,
      startTime: Date.now(),
      duration: 600,
    };
  }

  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    const now = Date.now();

    if (this.blockedXTile) {
      const elapsed = now - this.blockedXTile.startTime;
      if (elapsed < this.blockedXTile.duration) {
        const fraction = elapsed / this.blockedXTile.duration;
        const progress = 1 - (1 - fraction) * (1 - fraction);
        const animY = this.blockedXTile.y - progress * 2;
        const animAlpha = Math.max(0.0, 1.0 - progress * progress);

        gl.useProgram(this.program);
        if (this.statusAtlasTex) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this.statusAtlasTex);
          gl.uniform1i(this.uStatusAtlas, 1);
          gl.uniform1f(this.uHasAtlas, 1.0);
        } else {
          gl.uniform1f(this.uHasAtlas, 0.0);
        }
        gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
        gl.uniform2f(this.uCenter, this.blockedXTile.x, animY);
        gl.uniform1f(this.uHalfSize, CROSSHAIR_PX * 2.2);
        gl.uniform2f(
          this.uViewport,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
        );
        gl.uniform3f(this.uColor, 1.0, 0.05, 0.05); // bright red blocked X
        gl.uniform1f(this.uIsDiagonal, 1.0);
        gl.uniform1f(this.uAlpha, animAlpha);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else {
        this.blockedXTile = null;
      }
    }

    if (!this.active) return;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uCenter, this.centerX, this.centerY);
    gl.uniform1f(this.uHalfSize, CROSSHAIR_PX);
    gl.uniform2f(this.uViewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.uIsDiagonal, 0.0);
    gl.uniform1f(this.uAlpha, 1.0);

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
