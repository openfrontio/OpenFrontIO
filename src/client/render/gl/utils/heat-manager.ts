/**
 * HeatManager — GPU-side fallout heat decay and transition detection.
 *
 * Extracted from FalloutBloomPass. Owns the heat ping-pong textures, the
 * previous-tile-state snapshot, and the combined transition+decay shader.
 *
 * Used by both FalloutBloomPass (bloom extract reads heat) and LightmapPass
 * (fallout light reads heat). Shared heat textures come from GPUResources.
 */

import type { RenderSettings } from "../render-settings";
import {
  createFullscreenQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "./gl-utils";
import { FALLOUT_BIT, TILE_DEFINES } from "./tile-codec";

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
  /** True on first frame and after seek — blit tileTex→prevTileTex without transitions. */
  private needsPrevTileCopy = true;

  // Pending CPU → GPU writes
  private pendingDecay = 0;
  private pendingFullHeat: Uint8Array | null = null;
  /**
   * True when heat may be non-zero anywhere — gates the decay pass.
   * Set true on each game tick (shader may detect new fallout transitions).
   * Set false once accumulated decay since last activation exceeds 255 (fully drained).
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

    // 1. Upload reconstructed heat on seek
    if (this.pendingFullHeat) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heatReadTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        mw,
        mh,
        gl.RED,
        gl.UNSIGNED_BYTE,
        this.pendingFullHeat,
      );
      this.pendingFullHeat = null;
    }

    // 2. First frame / seek: copy tileTex → prevTileTex, skip transitions
    if (this.needsPrevTileCopy) {
      this.blitTileToPrev();
      this.needsPrevTileCopy = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }

    // 3. Skip decay pass when nothing to do — no pending decay and heat already settled.
    // Still blit tileTex→prevTileTex when a tick fired (pendingDecay > 0) so transition
    // detection stays accurate if heat activates later.
    if (!this.heatActive && this.pendingDecay === 0) return;
    if (!this.heatActive) {
      // Tick fired but no heat — just keep prevTileTex in sync and bail.
      this.blitTileToPrev();
      this.pendingDecay = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }

    // 4. Combined transition detection + decay (GPU ping-pong)
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

  /**
   * Reset heat state on seek. Reconstructs heat from nuke history and
   * masks out recaptured tiles.
   */
  resetForSeek(
    tileState: Uint16Array,
    nukeEvents?: Array<{ tick: number; tiles: number[] }>,
    currentTick?: number,
  ): void {
    let hasHeat = false;
    if (nukeEvents && nukeEvents.length > 0 && currentTick !== undefined) {
      const heat = this.reconstructHeat(nukeEvents, currentTick);
      this.maskHeat(heat, tileState);
      this.pendingFullHeat = heat;
      hasHeat = heat.some((v) => v > 0);
    } else {
      this.pendingFullHeat = new Uint8Array(this.mapW * this.mapH);
    }
    this.pendingDecay = 0;
    this.decayAccumulated = 0;
    this.heatActive = hasHeat;
    this.needsPrevTileCopy = true;
  }

  /** Accumulate heat decay for one game tick. */
  decayHeat(): void {
    this.pendingDecay += this.settings.falloutBloom.heatDecayPerTick;
    // A tick fired — the shader may detect new fallout transitions, so heat is potentially active.
    if (!this.heatActive) {
      this.heatActive = true;
      this.decayAccumulated = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private reconstructHeat(
    nukeEvents: Array<{ tick: number; tiles: number[] }>,
    currentTick: number,
  ): Uint8Array {
    const heat = new Uint8Array(this.mapW * this.mapH);
    const decay = this.settings.falloutBloom.heatDecayPerTick;
    for (const evt of nukeEvents) {
      if (evt.tick > currentTick) continue;
      const elapsed = currentTick - evt.tick;
      const h = Math.round(255 - elapsed * decay);
      if (h <= 0) continue;
      for (const ref of evt.tiles) {
        if (heat[ref] < h) heat[ref] = h;
      }
    }
    return heat;
  }

  private maskHeat(heat: Uint8Array, tileState: Uint16Array): void {
    for (let i = 0; i < heat.length; i++) {
      if (heat[i] > 0 && (tileState[i] & FALLOUT_BIT) === 0) {
        heat[i] = 0;
      }
    }
  }

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
