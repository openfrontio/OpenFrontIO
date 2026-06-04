/**
 * FalloutBloomPass — soft radioactive glow around irradiated tiles.
 *
 * Tile-space pipeline (camera-independent, zero shimmer):
 *   1. Extract — compute per-tile bloom at mapW/BLOOM_TILE_SCALE resolution
 *   2. Blur   — one separable 5-tap Gaussian pass
 *   3. Composite — camera-projected map quad samples blurred texture (LINEAR)
 *
 * Bloom buffers are sub-tile resolution because the output is heavily blurred
 * and composited with LINEAR sampling — going to 1/16 the fragments cuts
 * fill-rate cost on low-end GPUs (fillrate-bound by the per-fragment Gaussian
 * texture reads).
 *
 * Heat management is handled by HeatManager (shared with LightmapPass).
 */

const BLOOM_TILE_SCALE = 8;

import type { RenderSettings } from "../RenderSettings";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  shaderSrc,
} from "../utils/GlUtils";
import type { HeatManager } from "../utils/HeatManager";
import { TILE_DEFINES } from "../utils/TileCodec";

import compositeFragSrc from "../shaders/fallout-bloom/composite.frag.glsl?raw";
import compositeVertSrc from "../shaders/fallout-bloom/composite.vert.glsl?raw";
import extractFragSrc from "../shaders/fallout-bloom/extract.frag.glsl?raw";
import blurFragSrc from "../shaders/shared/blur.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

export class FalloutBloomPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;
  private heatManager: HeatManager;

  // Programs
  private extractProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  // Uniforms — extract
  private uExtractMapSize: WebGLUniformLocation;
  private uExtractTick: WebGLUniformLocation;
  private uExtractTileScale: WebGLUniformLocation;
  private uBroilSpeedCold: WebGLUniformLocation;
  private uBroilSpeedHot: WebGLUniformLocation;
  private uNoiseFreq1: WebGLUniformLocation;
  private uNoiseFreq2: WebGLUniformLocation;
  private uContrastLoCold: WebGLUniformLocation;
  private uContrastLoHot: WebGLUniformLocation;
  private uContrastHiCold: WebGLUniformLocation;
  private uContrastHiHot: WebGLUniformLocation;
  private uMetaFreq: WebGLUniformLocation;
  private uIntensityCold: WebGLUniformLocation;
  private uIntensityHot: WebGLUniformLocation;
  private uMetaInfluenceCold: WebGLUniformLocation;
  private uMetaInfluenceHot: WebGLUniformLocation;
  private uOpacityFadeEnd: WebGLUniformLocation;
  private uBloomColor: WebGLUniformLocation;
  private uParticleColorDark: WebGLUniformLocation;
  private uParticleColorBright: WebGLUniformLocation;
  private uParticleThresholdUnowned: WebGLUniformLocation;
  private uParticleThresholdOwned: WebGLUniformLocation;
  private uParticleFlickerSpeed: WebGLUniformLocation;
  private uParticleStrength: WebGLUniformLocation;
  private uParticleFreshScale: WebGLUniformLocation;

  // Uniforms — composite
  private uCompositeCam: WebGLUniformLocation;
  private uCompositeMapSize: WebGLUniformLocation;
  private uBloomCoverage: WebGLUniformLocation;

  // Uniforms — blur
  private uBlurDir: WebGLUniformLocation;

  // FBOs (mapW/BLOOM_TILE_SCALE × mapH/BLOOM_TILE_SCALE — fixed size)
  private bloomW: number;
  private bloomH: number;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;
  private texA: WebGLTexture;
  private texB: WebGLTexture;

  // Geometry
  private mapVao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    heatManager: HeatManager,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.heatManager = heatManager;

    // --- Extract program (tile-space, no camera) ---
    this.extractProg = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(extractFragSrc, TILE_DEFINES),
    );
    this.uExtractMapSize = gl.getUniformLocation(this.extractProg, "uMapSize")!;
    this.uExtractTick = gl.getUniformLocation(this.extractProg, "uTick")!;
    this.uExtractTileScale = gl.getUniformLocation(
      this.extractProg,
      "uTileScale",
    )!;
    this.uBroilSpeedCold = gl.getUniformLocation(
      this.extractProg,
      "uBroilSpeedCold",
    )!;
    this.uBroilSpeedHot = gl.getUniformLocation(
      this.extractProg,
      "uBroilSpeedHot",
    )!;
    this.uNoiseFreq1 = gl.getUniformLocation(this.extractProg, "uNoiseFreq1")!;
    this.uNoiseFreq2 = gl.getUniformLocation(this.extractProg, "uNoiseFreq2")!;
    this.uContrastLoCold = gl.getUniformLocation(
      this.extractProg,
      "uContrastLoCold",
    )!;
    this.uContrastLoHot = gl.getUniformLocation(
      this.extractProg,
      "uContrastLoHot",
    )!;
    this.uContrastHiCold = gl.getUniformLocation(
      this.extractProg,
      "uContrastHiCold",
    )!;
    this.uContrastHiHot = gl.getUniformLocation(
      this.extractProg,
      "uContrastHiHot",
    )!;
    this.uMetaFreq = gl.getUniformLocation(this.extractProg, "uMetaFreq")!;
    this.uIntensityCold = gl.getUniformLocation(
      this.extractProg,
      "uIntensityCold",
    )!;
    this.uIntensityHot = gl.getUniformLocation(
      this.extractProg,
      "uIntensityHot",
    )!;
    this.uMetaInfluenceCold = gl.getUniformLocation(
      this.extractProg,
      "uMetaInfluenceCold",
    )!;
    this.uMetaInfluenceHot = gl.getUniformLocation(
      this.extractProg,
      "uMetaInfluenceHot",
    )!;
    this.uOpacityFadeEnd = gl.getUniformLocation(
      this.extractProg,
      "uOpacityFadeEnd",
    )!;
    this.uBloomColor = gl.getUniformLocation(this.extractProg, "uBloomColor")!;
    this.uParticleColorDark = gl.getUniformLocation(
      this.extractProg,
      "uParticleColorDark",
    )!;
    this.uParticleColorBright = gl.getUniformLocation(
      this.extractProg,
      "uParticleColorBright",
    )!;
    this.uParticleThresholdUnowned = gl.getUniformLocation(
      this.extractProg,
      "uParticleThresholdUnowned",
    )!;
    this.uParticleThresholdOwned = gl.getUniformLocation(
      this.extractProg,
      "uParticleThresholdOwned",
    )!;
    this.uParticleFlickerSpeed = gl.getUniformLocation(
      this.extractProg,
      "uParticleFlickerSpeed",
    )!;
    this.uParticleStrength = gl.getUniformLocation(
      this.extractProg,
      "uParticleStrength",
    )!;
    this.uParticleFreshScale = gl.getUniformLocation(
      this.extractProg,
      "uParticleFreshScale",
    )!;
    gl.useProgram(this.extractProg);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uHeatTex"), 1);

    // --- Blur program ---
    this.blurProg = createProgram(gl, fullscreenVertSrc, blurFragSrc);
    this.uBlurDir = gl.getUniformLocation(this.blurProg, "uDir")!;
    gl.useProgram(this.blurProg);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, "uTex"), 0);

    // --- Composite program (camera-projected map quad) ---
    this.compositeProg = createProgram(gl, compositeVertSrc, compositeFragSrc);
    this.uCompositeCam = gl.getUniformLocation(this.compositeProg, "uCamera")!;
    this.uCompositeMapSize = gl.getUniformLocation(
      this.compositeProg,
      "uMapSize",
    )!;
    this.uBloomCoverage = gl.getUniformLocation(
      this.compositeProg,
      "uBloomCoverage",
    )!;
    gl.useProgram(this.compositeProg);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uTex"), 0);

    // --- FBO textures (sub-tile resolution) ---
    this.bloomW = Math.max(1, Math.floor(mapW / BLOOM_TILE_SCALE));
    this.bloomH = Math.max(1, Math.floor(mapH / BLOOM_TILE_SCALE));
    this.texA = this.createBloomTex(this.bloomW, this.bloomH);
    this.texB = this.createBloomTex(this.bloomW, this.bloomH);
    this.fboA = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texA,
      0,
    );
    this.fboB = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texB,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- Geometry ---
    this.mapVao = createMapQuad(gl, mapW, mapH);
    this.quadVao = createFullscreenQuad(gl);
  }

  private createBloomTex(w: number, h: number): WebGLTexture {
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

  /** Run the full extract → blur → composite pipeline. */
  draw(cameraMatrix: Float32Array, tick: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const cw = canvas.width;
    const ch = canvas.height;
    const mw = this.mapW;
    const mh = this.mapH;
    const bw = this.bloomW;
    const bh = this.bloomH;

    // --- 1. Extract: sub-tile-space bloom ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, bw, bh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    gl.useProgram(this.extractProg);
    gl.uniform2f(this.uExtractMapSize, mw, mh);
    gl.uniform1f(this.uExtractTick, tick);
    gl.uniform1f(this.uExtractTileScale, BLOOM_TILE_SCALE);

    const fb = this.settings.falloutBloom;
    gl.uniform1f(this.uBroilSpeedCold, fb.broilSpeedCold);
    gl.uniform1f(this.uBroilSpeedHot, fb.broilSpeedHot);
    gl.uniform1f(this.uNoiseFreq1, fb.noiseFreq1);
    gl.uniform1f(this.uNoiseFreq2, fb.noiseFreq2);
    gl.uniform1f(this.uContrastLoCold, fb.contrastLoCold);
    gl.uniform1f(this.uContrastLoHot, fb.contrastLoHot);
    gl.uniform1f(this.uContrastHiCold, fb.contrastHiCold);
    gl.uniform1f(this.uContrastHiHot, fb.contrastHiHot);
    gl.uniform1f(this.uMetaFreq, fb.metaFreq);
    gl.uniform1f(this.uIntensityCold, fb.intensityCold);
    gl.uniform1f(this.uIntensityHot, fb.intensityHot);
    gl.uniform1f(this.uMetaInfluenceCold, fb.metaInfluenceCold);
    gl.uniform1f(this.uMetaInfluenceHot, fb.metaInfluenceHot);
    gl.uniform1f(this.uOpacityFadeEnd, fb.opacityFadeEnd);
    gl.uniform3f(this.uBloomColor, fb.bloomR, fb.bloomG, fb.bloomB);
    gl.uniform3f(
      this.uParticleColorDark,
      fb.particleColorDarkR,
      fb.particleColorDarkG,
      fb.particleColorDarkB,
    );
    gl.uniform3f(
      this.uParticleColorBright,
      fb.particleColorBrightR,
      fb.particleColorBrightG,
      fb.particleColorBrightB,
    );
    gl.uniform1f(this.uParticleThresholdUnowned, fb.particleThresholdUnowned);
    gl.uniform1f(this.uParticleThresholdOwned, fb.particleThresholdOwned);
    gl.uniform1f(this.uParticleFlickerSpeed, fb.particleFlickerSpeed);
    gl.uniform1f(this.uParticleStrength, fb.particleStrength);
    gl.uniform1f(this.uParticleFreshScale, fb.particleFreshScale);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.heatManager.getHeatTex());
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- 2. Blur: single separable H+V 5-tap Gaussian ---
    gl.useProgram(this.blurProg);
    gl.bindVertexArray(this.quadVao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.viewport(0, 0, bw, bh);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uBlurDir, 1.0 / bw, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, bw, bh);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uBlurDir, 0, 1.0 / bh);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- 3. Composite: camera-projected map quad → screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.compositeProg);
    gl.uniformMatrix3fv(this.uCompositeCam, false, cameraMatrix);
    gl.uniform2f(this.uCompositeMapSize, mw, mh);
    gl.uniform1f(this.uBloomCoverage, fb.bloomCoverage);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.bindVertexArray(this.mapVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Restore standard alpha blending
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.extractProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compositeProg);
    gl.deleteFramebuffer(this.fboA);
    gl.deleteFramebuffer(this.fboB);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    gl.deleteVertexArray(this.mapVao);
    gl.deleteVertexArray(this.quadVao);
  }
}
