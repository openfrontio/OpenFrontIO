/**
 * HeatManager — GPU-side fallout heat decay and transition detection.
 *
 * Extracted from FalloutBloomPass. Owns the heat ping-pong textures, the
 * previous-tile-state snapshot, and the combined transition+decay shader.
 *
 * Used by both FalloutBloomPass (bloom extract reads heat) and LightmapPass
 * (fallout light reads heat). Shared heat textures come from GPUResources.
 */

import type { RenderSettings } from "../RenderSettings";
import {
  createFullscreenQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "./GlUtils";
import { TILE_DEFINES } from "./TileCodec";

import heatDecayFragSrc from "../shaders/fallout-bloom/heat-decay.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";

export class HeatManager {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  // Heat ping-pong (R8, per-tile: 255=fresh, decays toward 0)
  private heatTexA: WebGLTexture;
  private heatTexB: WebGLTexture;
  private heatFboA: WebGLFramebuffer;
  private heatFboB: WebGLFramebuffer;
  /** 0 = read A / write B, 1 = read B / write A */
  private heatCurrent = 0;

  // Previous tile state (R16UI) — GPU-side snapshot for transition detection
  private prevTileTex: WebGLTexture;
  private prevTileFbo: WebGLFramebuffer;
  private tileTexReadFbo: WebGLFramebuffer;
  /** True on first frame — blit tileTex→prevTileTex without transitions. */
  private needsPrevTileCopy = true;

  // Pending CPU → GPU writes
  private pendingDecay = 0;
  /**
   * True when heat may be non-zero anywhere — gates the decay pass.
   * Set true via activate() whenever a tile's fallout bit flips (or a full
   * state replacement happens). Set false once accumulated decay since last
   * activation exceeds 255 (fully drained). While false, updateHeat() does no
   * GPU work at all.
   */
  private heatActive = false;
  /** Accumulated decay since heatActive was last set true. */
  private decayAccumulated = 0;

  // Decay program
  private decayProg: WebGLProgram;
  private uDecayMapSize: WebGLUniformLocation;
  private uDecayAmount: WebGLUniformLocation;

  // Geometry
  private quadVao: WebGLVertexArrayObject;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    heatTexA: WebGLTexture,
    heatTexB: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.heatTexA = heatTexA;
    this.heatTexB = heatTexB;

    this.heatFboA = this.createFboFor(heatTexA);
    this.heatFboB = this.createFboFor(heatTexB);

    // Previous tile state texture (R16UI, for GPU transition detection)
    this.prevTileTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R16UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: null,
      filter: gl.NEAREST,
    });
    this.prevTileFbo = this.createFboFor(this.prevTileTex);
    this.tileTexReadFbo = this.createFboFor(tileTex);

    // Decay program (tile-space, combined transition + decay)
    this.decayProg = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(heatDecayFragSrc, TILE_DEFINES),
    );
    this.uDecayMapSize = gl.getUniformLocation(this.decayProg, "uMapSize")!;
    this.uDecayAmount = gl.getUniformLocation(this.decayProg, "uDecay")!;
    gl.useProgram(this.decayProg);
    gl.uniform1i(gl.getUniformLocation(this.decayProg, "uHeatTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.decayProg, "uTileTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.decayProg, "uPrevTileTex"), 2);

    this.quadVao = createFullscreenQuad(gl);
  }

  private createFboFor(tex: WebGLTexture): WebGLFramebuffer {
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

  /** Current heat read texture. */
  private get heatReadTex(): WebGLTexture {
    return this.heatCurrent === 0 ? this.heatTexA : this.heatTexB;
  }
  private get heatWriteFbo(): WebGLFramebuffer {
    return this.heatCurrent === 0 ? this.heatFboB : this.heatFboA;
  }
  private swapHeat(): void {
    this.heatCurrent = 1 - this.heatCurrent;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current heat texture for reading (bloom extract and lightmap). */
  getHeatTex(): WebGLTexture {
    return this.heatReadTex;
  }

  /**
   * Run GPU heat update: detect fallout-bit transitions, apply decay,
   * then snapshot tileTex → prevTileTex.
   *
   * Call once per frame after tile texture is flushed to GPU.
   */
  updateHeat(): void {
    const gl = this.gl;
    const mw = this.mapW;
    const mh = this.mapH;

    // 1. First frame: copy tileTex → prevTileTex, skip transitions
    if (this.needsPrevTileCopy) {
      this.blitTileToPrev();
      this.needsPrevTileCopy = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }

    // 2. Inactive: no heat anywhere, and no fallout bits can change without
    // activate() being called first (TerritoryPass flags every fallout-bit
    // flip before the tile flush reaches the GPU). prevTileTex can go stale
    // in owner bits only, which the transition test ignores — so skip all GPU
    // work, including the prev-tile blit.
    if (!this.heatActive) {
      this.pendingDecay = 0;
      return;
    }

    // 3. Combined transition detection + decay (GPU ping-pong)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.heatWriteFbo);
    gl.viewport(0, 0, mw, mh);
    gl.disable(gl.BLEND);

    gl.useProgram(this.decayProg);
    gl.uniform2f(this.uDecayMapSize, mw, mh);
    gl.uniform1f(this.uDecayAmount, this.pendingDecay);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heatReadTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTileTex);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.swapHeat();
    this.decayAccumulated += this.pendingDecay;
    if (this.decayAccumulated >= 255) this.heatActive = false;
    this.pendingDecay = 0;

    // 5. Snapshot current tileTex → prevTileTex for next frame
    this.blitTileToPrev();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** GPU blit: tileTex → prevTileTex (R16UI, NEAREST). */
  private blitTileToPrev(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.tileTexReadFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.prevTileFbo);
    gl.blitFramebuffer(
      0,
      0,
      this.mapW,
      this.mapH,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  /** Accumulate heat decay for one game tick. */
  decayHeat(): void {
    this.pendingDecay += this.settings.falloutBloom.heatDecayPerTick;
  }

  /**
   * Activate the heat pipeline: a fallout bit flipped, so the decay pass must
   * run (transition detection stamps fresh heat / clears recaptured tiles).
   * Resets the drain window — fresh heat needs a full 255 of decay again.
   */
  activate(): void {
    this.heatActive = true;
    this.decayAccumulated = 0;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.decayProg);
    gl.deleteFramebuffer(this.heatFboA);
    gl.deleteFramebuffer(this.heatFboB);
    gl.deleteFramebuffer(this.prevTileFbo);
    gl.deleteFramebuffer(this.tileTexReadFbo);
    gl.deleteTexture(this.prevTileTex);
    gl.deleteVertexArray(this.quadVao);
  }
}
