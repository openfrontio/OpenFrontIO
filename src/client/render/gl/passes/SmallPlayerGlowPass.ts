/**
 * SmallPlayerGlowPass — a soft, breathing red aura around the territory of
 * "small" players (the highlight set pushed each tick).
 *
 * Tile-space bloom pipeline, mirroring FalloutBloomPass (camera-independent, so
 * no shimmer when panning/zooming):
 *   1. Extract — at sub-tile resolution, mark cells that contain a small
 *      player's tile (block-scanned so sparse single tiles aren't missed).
 *   2. Blur    — one separable H+V Gaussian pass (shared blur shader).
 *   3. Composite — a camera-projected map quad samples the blurred aura,
 *      tints it with the glow color and the breathing intensity, and blends it
 *      additively over the map.
 *
 * Active only while the highlight set is non-empty (the "Highlight small
 * players" setting is on and the grace period has passed) — otherwise draw() is
 * a no-op and costs nothing.
 */

import type { RenderSettings } from "../RenderSettings";
import blurFragSrc from "../shaders/shared/blur.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";
import compositeFragSrc from "../shaders/small-player-glow/composite.frag.glsl?raw";
import compositeVertSrc from "../shaders/small-player-glow/composite.vert.glsl?raw";
import extractFragSrc from "../shaders/small-player-glow/extract.frag.glsl?raw";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createFullscreenQuad,
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

// 1 px per owner smallID (indexed by owner); sized to the palette.
const SET_TEX_WIDTH = getPaletteSize();
// Bloom buffers run at 1/scale of tile resolution; the blur + LINEAR upsample
// turn that into a soft aura cheaply. The extract scans each scale×scale block.
const BLOOM_TILE_SCALE = 4;

export class SmallPlayerGlowPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings["smallPlayerGlow"];
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  private extractProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  private uExtractMapSize: WebGLUniformLocation;
  private uBlurDir: WebGLUniformLocation;
  private uCompositeCam: WebGLUniformLocation;
  private uCompositeMapSize: WebGLUniformLocation;
  private uGlowColor: WebGLUniformLocation;
  private uIntensity: WebGLUniformLocation;

  private setTex: WebGLTexture;
  private bloomW: number;
  private bloomH: number;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private mapVao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject;

  private active = false;
  private animTime = 0;
  private lastTime = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings["smallPlayerGlow"],
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;

    // --- Extract program (tile space, no camera) ---
    this.extractProg = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(extractFragSrc, {
        ...TILE_DEFINES,
        TILE_SCALE: BLOOM_TILE_SCALE,
      }),
    );
    this.uExtractMapSize = gl.getUniformLocation(this.extractProg, "uMapSize")!;
    gl.useProgram(this.extractProg);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.extractProg, "uHighlightSet"), 1);

    // --- Blur program (shared separable Gaussian) ---
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
    this.uGlowColor = gl.getUniformLocation(this.compositeProg, "uGlowColor")!;
    this.uIntensity = gl.getUniformLocation(this.compositeProg, "uIntensity")!;
    gl.useProgram(this.compositeProg);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uTex"), 0);

    // --- Per-owner highlight set (R8UI, 1 row) ---
    this.setTex = createTexture2D(gl, {
      width: SET_TEX_WIDTH,
      height: 1,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    // --- Bloom FBOs (sub-tile resolution) ---
    this.bloomW = Math.max(1, Math.floor(mapW / BLOOM_TILE_SCALE));
    this.bloomH = Math.max(1, Math.floor(mapH / BLOOM_TILE_SCALE));
    this.texA = this.createBloomTex(this.bloomW, this.bloomH);
    this.texB = this.createBloomTex(this.bloomW, this.bloomH);
    this.fboA = this.createFbo(this.texA);
    this.fboB = this.createFbo(this.texB);

    this.mapVao = createMapQuad(gl, mapW, mapH);
    this.quadVao = createFullscreenQuad(gl);
  }

  private createBloomTex(w: number, h: number): WebGLTexture {
    return createTexture2D(this.gl, {
      width: w,
      height: h,
      internalFormat: this.gl.RGBA8,
      format: this.gl.RGBA,
      type: this.gl.UNSIGNED_BYTE,
      data: null,
      filter: this.gl.LINEAR,
    });
  }

  private createFbo(tex: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  /**
   * Push the highlight set: 1 byte per owner smallID (1 = glow), or null to
   * turn the glow off. Uploaded immediately, so the caller may reuse the array.
   */
  update(set: Uint8Array | null): void {
    if (set === null) {
      this.active = false;
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.setTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      Math.min(set.length, SET_TEX_WIDTH),
      1,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      set,
    );
    this.active = true;
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.active) return;

    const gl = this.gl;
    const s = this.settings;
    const canvas = gl.canvas as HTMLCanvasElement;
    const bw = this.bloomW;
    const bh = this.bloomH;

    const now = performance.now();
    if (this.lastTime > 0) {
      this.animTime += (now - this.lastTime) * s.pulseSpeed;
    }
    this.lastTime = now;
    const pulse = 0.5 + 0.5 * Math.sin(this.animTime);

    // --- 1. Extract mask at sub-tile resolution ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, bw, bh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(this.extractProg);
    gl.uniform2f(this.uExtractMapSize, this.mapW, this.mapH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.setTex);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- 2. Separable blur (H then V) ---
    gl.useProgram(this.blurProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.uniform2f(this.uBlurDir, 1.0 / bw, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.uniform2f(this.uBlurDir, 0, 1.0 / bh);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- 3. Composite over the map (additive, camera-projected) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // premultiplied + additive glow
    gl.useProgram(this.compositeProg);
    gl.uniformMatrix3fv(this.uCompositeCam, false, cameraMatrix);
    gl.uniform2f(this.uCompositeMapSize, this.mapW, this.mapH);
    gl.uniform3fv(this.uGlowColor, s.color);
    gl.uniform1f(this.uIntensity, s.alpha * pulse);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.bindVertexArray(this.mapVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    // Restore the overlay default so following passes render normally.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.extractProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compositeProg);
    gl.deleteTexture(this.setTex);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    gl.deleteFramebuffer(this.fboA);
    gl.deleteFramebuffer(this.fboB);
    gl.deleteVertexArray(this.mapVao);
    gl.deleteVertexArray(this.quadVao);
    // tileTex owned by GPUResources
  }
}
