/**
 * FalloutLightPass — tile-space fallout light extraction + composite.
 *
 * Extracted from LightmapPass. Two-step:
 *   1. Extract fallout light at tile resolution (mapW x mapH) — reads heat + embers
 *   2. Composite into the target lightmap FBO via camera-projected map quad (additive)
 */

import type { RenderSettings } from "../RenderSettings";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  shaderSrc,
} from "../utils/GlUtils";
import type { HeatManager } from "../utils/HeatManager";
import { TILE_DEFINES } from "../utils/TileCodec";

import falloutCompositeFragSrc from "../shaders/day-night/fallout-composite.frag.glsl?raw";
import falloutCompositeVertSrc from "../shaders/day-night/fallout-composite.vert.glsl?raw";
import falloutLightFragSrc from "../shaders/day-night/fallout-light.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";

export class FalloutLightPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;
  private heatManager: HeatManager;
  private tileTex: WebGLTexture;
  private borderTex: WebGLTexture;

  // Fallout light extraction
  private falloutLightProg: WebGLProgram;
  private uFalloutMapSize: WebGLUniformLocation;
  private uFalloutLightColor: WebGLUniformLocation;
  private uFalloutLightIntensity: WebGLUniformLocation;
  private uFalloutLightThreshold: WebGLUniformLocation;
  private uEmberLightColor: WebGLUniformLocation;
  private uEmberLightIntensity: WebGLUniformLocation;

  // Fallout composite (tile-space → lightmap)
  private falloutCompositeProg: WebGLProgram;
  private uFalloutCompositeCam: WebGLUniformLocation;
  private uFalloutCompositeMapSize: WebGLUniformLocation;

  // Tile-space FBO
  private falloutFbo: WebGLFramebuffer;
  private falloutTex: WebGLTexture;

  // Geometry
  private quadVao: WebGLVertexArrayObject;
  private mapQuadVao: WebGLVertexArrayObject;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    borderTex: WebGLTexture,
    heatManager: HeatManager,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.borderTex = borderTex;
    this.heatManager = heatManager;

    // Fallout light extraction program
    this.falloutLightProg = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(falloutLightFragSrc, TILE_DEFINES),
    );
    this.uFalloutMapSize = gl.getUniformLocation(
      this.falloutLightProg,
      "uMapSize",
    )!;
    this.uFalloutLightColor = gl.getUniformLocation(
      this.falloutLightProg,
      "uFalloutLightColor",
    )!;
    this.uFalloutLightIntensity = gl.getUniformLocation(
      this.falloutLightProg,
      "uFalloutLightIntensity",
    )!;
    this.uFalloutLightThreshold = gl.getUniformLocation(
      this.falloutLightProg,
      "uFalloutLightThreshold",
    )!;
    this.uEmberLightColor = gl.getUniformLocation(
      this.falloutLightProg,
      "uEmberLightColor",
    )!;
    this.uEmberLightIntensity = gl.getUniformLocation(
      this.falloutLightProg,
      "uEmberLightIntensity",
    )!;
    gl.useProgram(this.falloutLightProg);
    gl.uniform1i(gl.getUniformLocation(this.falloutLightProg, "uHeatTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.falloutLightProg, "uTileTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.falloutLightProg, "uBorderTex"), 2);

    // Fallout composite program
    this.falloutCompositeProg = createProgram(
      gl,
      falloutCompositeVertSrc,
      falloutCompositeFragSrc,
    );
    this.uFalloutCompositeCam = gl.getUniformLocation(
      this.falloutCompositeProg,
      "uCamera",
    )!;
    this.uFalloutCompositeMapSize = gl.getUniformLocation(
      this.falloutCompositeProg,
      "uMapSize",
    )!;
    gl.useProgram(this.falloutCompositeProg);
    gl.uniform1i(gl.getUniformLocation(this.falloutCompositeProg, "uTex"), 0);

    // Tile-space FBO (map resolution)
    this.falloutTex = this.createRGBA8Tex(mapW, mapH);
    this.falloutFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.falloutFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.falloutTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Geometry
    this.quadVao = createFullscreenQuad(gl);
    this.mapQuadVao = createMapQuad(gl, mapW, mapH);
  }

  private createRGBA8Tex(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /**
   * Extract fallout light in tile space, then composite into the target FBO.
   * Caller must bind the target FBO and set additive blending before calling.
   */
  draw(
    cameraMatrix: Float32Array,
    targetFbo: WebGLFramebuffer,
    targetW: number,
    targetH: number,
  ): void {
    const gl = this.gl;
    const dn = this.settings.dayNight;

    // Step 1: Extract fallout light in tile space
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.falloutFbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    gl.useProgram(this.falloutLightProg);
    gl.uniform2f(this.uFalloutMapSize, this.mapW, this.mapH);
    gl.uniform3f(
      this.uFalloutLightColor,
      dn.falloutLightR,
      dn.falloutLightG,
      dn.falloutLightB,
    );
    gl.uniform1f(this.uFalloutLightIntensity, dn.falloutLightIntensity);
    gl.uniform1f(this.uFalloutLightThreshold, dn.falloutLightThreshold);
    gl.uniform3f(
      this.uEmberLightColor,
      dn.emberLightR,
      dn.emberLightG,
      dn.emberLightB,
    );
    gl.uniform1f(this.uEmberLightIntensity, dn.emberLightIntensity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heatManager.getHeatTex());
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.borderTex);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Step 2: Composite tile-space fallout into target lightmap
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(0, 0, targetW, targetH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive

    gl.useProgram(this.falloutCompositeProg);
    gl.uniformMatrix3fv(this.uFalloutCompositeCam, false, cameraMatrix);
    gl.uniform2f(this.uFalloutCompositeMapSize, this.mapW, this.mapH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.falloutTex);
    gl.bindVertexArray(this.mapQuadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.falloutLightProg);
    gl.deleteProgram(this.falloutCompositeProg);
    gl.deleteFramebuffer(this.falloutFbo);
    gl.deleteTexture(this.falloutTex);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteVertexArray(this.mapQuadVao);
  }
}
