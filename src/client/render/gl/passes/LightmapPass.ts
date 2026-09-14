/**
 * LightmapPass — orchestrator: point lights + fallout lights → blur → final texture.
 *
 * Owns the quarter-resolution lightmap ping-pong FBOs and the blur shader.
 * Delegates light rendering to PointLightPass and FalloutLightPass.
 */

import type { RenderSettings } from "../RenderSettings";
import { createFullscreenQuad, createProgram } from "../utils/GlUtils";
import type { FalloutLightPass } from "./FalloutLightPass";
import type { PointLightPass } from "./PointLightPass";

import blurFragSrc from "../shaders/shared/blur.frag.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

export class LightmapPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private pointLightPass: PointLightPass;
  private falloutLightPass: FalloutLightPass;

  // Blur program
  private blurProg: WebGLProgram;
  private uBlurDir: WebGLUniformLocation;

  // Quarter-res lightmap ping-pong
  private lightFboA: WebGLFramebuffer;
  private lightFboB: WebGLFramebuffer;
  private lightTexA: WebGLTexture;
  private lightTexB: WebGLTexture;
  private lightW = 0;
  private lightH = 0;

  // Geometry
  private quadVao: WebGLVertexArrayObject;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    pointLightPass: PointLightPass,
    falloutLightPass: FalloutLightPass,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.pointLightPass = pointLightPass;
    this.falloutLightPass = falloutLightPass;

    // Blur program
    this.blurProg = createProgram(gl, fullscreenVertSrc, blurFragSrc);
    this.uBlurDir = gl.getUniformLocation(this.blurProg, "uDir")!;
    gl.useProgram(this.blurProg);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, "uTex"), 0);

    // Lightmap FBOs (1×1 placeholder, resized lazily)
    this.lightTexA = this.createRGBA8Tex();
    this.lightTexB = this.createRGBA8Tex();
    this.lightFboA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFboA);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.lightTexA,
      0,
    );
    this.lightFboB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFboB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.lightTexB,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.quadVao = createFullscreenQuad(gl);
  }

  private createRGBA8Tex(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private ensureLightSize(w: number, h: number): void {
    if (w === this.lightW && h === this.lightH) return;
    this.lightW = w;
    this.lightH = h;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTexA);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, this.lightTexB);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  /** Generate the lightmap and return the final blurred texture. */
  draw(
    cameraMatrix: Float32Array,
    sceneW: number,
    sceneH: number,
    tick: number,
  ): WebGLTexture {
    const gl = this.gl;
    const lw = Math.max(1, sceneW >> 1);
    const lh = Math.max(1, sceneH >> 1);
    this.ensureLightSize(lw, lh);

    // --- 1. Point lights → FBO A (additive) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFboA);
    gl.viewport(0, 0, lw, lh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive

    this.pointLightPass.draw(cameraMatrix);

    // --- 2. Fallout light → extract at tile res, composite into FBO A (additive) ---
    if (this.settings.passEnabled.falloutLight) {
      this.falloutLightPass.draw(cameraMatrix, this.lightFboA, lw, lh, tick);
    }

    // --- 3. Blur: 2 iterations separable H+V Gaussian ---
    const zoom = Math.abs(cameraMatrix[0]);
    const mapSize = Math.max(this.mapW, this.mapH);
    const blurScale = Math.min(
      (zoom * mapSize) / this.settings.lighting.blurZoomDivisor,
      1.0,
    );

    gl.disable(gl.BLEND);
    gl.useProgram(this.blurProg);
    gl.bindVertexArray(this.quadVao);

    for (let iter = 0; iter < 2; iter++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFboB);
      gl.viewport(0, 0, lw, lh);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.uBlurDir, blurScale / lw, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.lightTexA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFboA);
      gl.viewport(0, 0, lw, lh);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.uBlurDir, 0, blurScale / lh);
      gl.bindTexture(gl.TEXTURE_2D, this.lightTexB);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    return this.lightTexA;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.blurProg);
    gl.deleteFramebuffer(this.lightFboA);
    gl.deleteFramebuffer(this.lightFboB);
    gl.deleteTexture(this.lightTexA);
    gl.deleteTexture(this.lightTexB);
    gl.deleteVertexArray(this.quadVao);
    // pointLightPass and falloutLightPass disposed by renderer
  }
}
