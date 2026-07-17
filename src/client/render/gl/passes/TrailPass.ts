/**
 * TrailPass — boat + nuke trail lines.
 *
 * Owns the dirty-row bookkeeping for partial GPU uploads and the trail
 * fragment shader that draws the colored breadcrumb behind moving units.
 * Trail state itself (R32UI: 0=none, bits 0-11=ownerID, bit 12=nuke trail,
 * bits 13-20=spiral phase) is referenced from the caller's array, not copied.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize, MAX_TRAIL_COLORS } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import spiralCompositeFragSrc from "../shaders/map-overlay/spiral-composite.frag.glsl?raw";
import spiralTrailFragSrc from "../shaders/map-overlay/spiral-trail.frag.glsl?raw";
import trailFragSrc from "../shaders/map-overlay/trail.frag.glsl?raw";
import fullscreenVertSrc from "../shaders/shared/fullscreen.vert.glsl?raw";

export class TrailPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uTrailAlpha: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;

  // Spiral buffer pass — renders the vortex ribbons into a reduced-resolution
  // FBO (spiralResolutionScale), bilinearly composited over the plain trails:
  // cuts the gather cost by the scale factor squared and softens the look.
  private spiralProgram: WebGLProgram;
  private uSpCamera: WebGLUniformLocation;
  private uSpMapSize: WebGLUniformLocation;
  private uSpTrailAlpha: WebGLUniformLocation;
  private uSpTime: WebGLUniformLocation;
  private uSpBounds: WebGLUniformLocation;
  private compositeProgram: WebGLProgram;
  private fsQuadVao: WebGLVertexArrayObject;
  private spiralFbo: WebGLFramebuffer | null = null;
  private spiralFboTex: WebGLTexture | null = null;
  private spiralFboW = 0;
  private spiralFboH = 0;

  private vao: WebGLVertexArrayObject;
  private trailTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private effectTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;
  // Whether any player's nukeTrail effect is spiral — gates the shader's
  // neighborhood-gather reconstruction (set from updateEffectPalette).
  private spiralActive = false;
  // Bounds [minX, minY, maxX, maxY] of currently-stamped spiral tiles
  // (empty when minX > maxX) — the shader skips the gather outside them, so
  // the effect costs nothing while no spiral nuke trail exists.
  private readonly spiralBounds = new Int32Array([1, 1, 0, 0]);
  // Anchor animation time at construction (like NukeTelegraphPass/SamRadiusPass)
  // so the value stays small and sin()/fract() don't quantize over long sessions.
  private readonly startTime = performance.now();

  private trailsDirty = false;

  /**
   * Reference to the caller-owned trail state (R32UI: 0=none, owner in bits
   * 0-11, nuke bit 12, spiral phase bits 13-20). Every upload entry point
   * provides it, so the pass keeps no copy of its own; the caller's array
   * must stay current until the flush. Null until the first upload.
   */
  private liveTrailRef: Uint32Array | null = null;

  /** Dirty row range for partial trail upload. Infinity/-1 = full upload. */
  private dirtyRowMin = Infinity;
  private dirtyRowMax = -1;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    trailTex: WebGLTexture,
    paletteTex: WebGLTexture,
    effectTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.trailTex = trailTex;
    this.paletteTex = paletteTex;
    this.effectTex = effectTex;

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(trailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        MAX_TRAIL_COLORS,
        ...TILE_DEFINES,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uTrailAlpha = gl.getUniformLocation(this.program, "uTrailAlpha")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTrailTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEffect"), 3);

    // Spiral buffer pass (same map quad + camera, spiral-only fragment work).
    this.spiralProgram = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(spiralTrailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        MAX_TRAIL_COLORS,
        ...TILE_DEFINES,
      }),
    );
    this.uSpCamera = gl.getUniformLocation(this.spiralProgram, "uCamera")!;
    this.uSpMapSize = gl.getUniformLocation(this.spiralProgram, "uMapSize")!;
    this.uSpTrailAlpha = gl.getUniformLocation(
      this.spiralProgram,
      "uTrailAlpha",
    )!;
    this.uSpTime = gl.getUniformLocation(this.spiralProgram, "uTime")!;
    this.uSpBounds = gl.getUniformLocation(
      this.spiralProgram,
      "uSpiralBounds",
    )!;
    gl.useProgram(this.spiralProgram);
    gl.uniform1i(gl.getUniformLocation(this.spiralProgram, "uTrailTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.spiralProgram, "uEffect"), 3);

    // Composite: fullscreen quad sampling the spiral buffer (unit 0).
    this.compositeProgram = createProgram(
      gl,
      fullscreenVertSrc,
      spiralCompositeFragSrc,
    );
    gl.useProgram(this.compositeProgram);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, "uTex"), 0);
    this.fsQuadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fsQuadVao);
    const fsBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setSpiralActive(active: boolean): void {
    this.spiralActive = active;
  }
  setSpiralBounds(bounds: Int32Array): void {
    this.spiralBounds.set(bounds);
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  // ---------------------------------------------------------------------------
  // Trail data upload
  // ---------------------------------------------------------------------------

  /** Live-game path: reference the game's own trail array directly. */
  setLiveRef(trailState: Uint32Array): void {
    this.liveTrailRef = trailState;
    this.trailsDirty = true;
  }

  /** Live trail delta: update live ref + accept dirty row range from TrailManager. */
  applyLiveDelta(
    trailState: Uint32Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.liveTrailRef = trailState;
    if (dirtyRowMax >= 0) {
      const isFullUploadPending = this.trailsDirty && this.dirtyRowMax < 0;
      // If a full upload is already pending, don't narrow the bounds to the delta
      if (!isFullUploadPending) {
        this.dirtyRowMin = Math.min(this.dirtyRowMin, dirtyRowMin);
        this.dirtyRowMax = Math.max(this.dirtyRowMax, dirtyRowMax);
      }
    }
    this.trailsDirty = true;
  }

  /** Flush trail texture to GPU. Called once per render frame in uploadTextures. */
  flushTexture(): void {
    if (!this.trailsDirty) return;
    const src = this.liveTrailRef;
    if (src === null) return; // dirty is only ever set alongside the ref
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);

    if (this.dirtyRowMax >= 0) {
      // Partial upload — only dirty rows
      const minRow = this.dirtyRowMin;
      const rowCount = this.dirtyRowMax - minRow + 1;
      const offset = minRow * this.mapW;
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        minRow,
        this.mapW,
        rowCount,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        src.subarray(offset, offset + rowCount * this.mapW),
      );
    } else {
      // Full upload (first tick, seek, replay, etc.)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.mapW,
        this.mapH,
        gl.RED_INTEGER,
        gl.UNSIGNED_INT,
        src,
      );
    }

    this.dirtyRowMin = Infinity;
    this.dirtyRowMax = -1;
    this.trailsDirty = false;
  }

  /** Draw trail overlay. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    this.flushTexture();
    const gl = this.gl;

    // Spiral ribbons render into a reduced-resolution buffer first, then
    // composite over the plain trails below. Skipped entirely (zero cost)
    // unless spiral tiles are actually stamped right now.
    const spiralLive =
      this.spiralActive &&
      !this.altView &&
      this.spiralBounds[0] <= this.spiralBounds[2];
    if (spiralLive) this.renderSpiralBuffer(cameraMatrix);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTrailAlpha, this.settings.mapOverlay.trailAlpha);
    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (spiralLive) this.compositeSpiralBuffer();
  }

  /** (Re)create the spiral render target at the current scaled canvas size. */
  private ensureSpiralTarget(w: number, h: number): void {
    if (
      this.spiralFbo !== null &&
      w === this.spiralFboW &&
      h === this.spiralFboH
    ) {
      return;
    }
    const gl = this.gl;
    if (this.spiralFboTex === null) {
      this.spiralFboTex = gl.createTexture();
      this.spiralFbo = gl.createFramebuffer();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.spiralFboTex);
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
    // LINEAR — the bilinear upsample at composite is what softens the look.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.spiralFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.spiralFboTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.spiralFboW = w;
    this.spiralFboH = h;
  }

  /** Render the spiral ribbons into the reduced-resolution buffer. */
  private renderSpiralBuffer(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    const scale = this.settings.mapOverlay.spiralResolutionScale;
    const w = Math.max(1, Math.round(gl.drawingBufferWidth * scale));
    const h = Math.max(1, Math.round(gl.drawingBufferHeight * scale));
    this.ensureSpiralTarget(w, h);

    // The surrounding pipeline may be rendering into its own target
    // (day-night scene FBO) — save and restore rather than assuming screen.
    const prevFbo = gl.getParameter(
      gl.FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.spiralFbo);
    gl.viewport(0, 0, w, h);
    // One fragment per pixel from a single quad — no blending needed; the
    // shader writes premultiplied alpha over the transparent clear.
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.spiralProgram);
    gl.uniformMatrix3fv(this.uSpCamera, false, cameraMatrix);
    gl.uniform2f(this.uSpMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uSpTrailAlpha, this.settings.mapOverlay.trailAlpha);
    gl.uniform1f(this.uSpTime, (performance.now() - this.startTime) / 1000);
    const sb = this.spiralBounds;
    gl.uniform4f(this.uSpBounds, sb[0], sb[1], sb[2], sb[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(
      prevViewport[0],
      prevViewport[1],
      prevViewport[2],
      prevViewport[3],
    );
    gl.enable(gl.BLEND);
  }

  /** Bilinearly composite the spiral buffer over the scene (premultiplied). */
  private compositeSpiralBuffer(): void {
    const gl = this.gl;
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spiralFboTex);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.fsQuadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // restore overlay default
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.spiralProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.fsQuadVao);
    if (this.spiralFbo) gl.deleteFramebuffer(this.spiralFbo);
    if (this.spiralFboTex) gl.deleteTexture(this.spiralFboTex);
  }
}
