/**
 * TrailPass — boat trail lines.
 *
 * Owns the CPU-side trail state (R8UI, 0=none, 1–255=ownerID), the dirty-row
 * bookkeeping for partial GPU uploads, and the trail fragment shader that
 * draws the colored breadcrumb behind moving units.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import trailFragSrc from "../shaders/map-overlay/trail.frag.glsl?raw";

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

  private vao: WebGLVertexArrayObject;
  private trailTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;

  /**
   * Per-owner trail cosmetic style (RGBA8, width = palette size, height 2).
   * Row 0: rgb = base color, a = effect id (0 none, 1 solid, 2 rainbow,
   * 3 pulse, 4 gradient). Row 1: rgb = second color (gradient only).
   * Zero-initialized so players without a trail cosmetic fall back to their
   * palette color in the shader.
   */
  private trailStyleTex: WebGLTexture;
  private trailStyleCpu: Uint8Array;

  /** CPU-side trail state (R8UI, 0=none, 1–255=ownerID). */
  private cpuTrailState: Uint8Array;
  private trailsDirty = false;

  /** Live-game reference — bypasses memcpy. Null for replay path. */
  private liveTrailRef: Uint8Array | null = null;

  /** Dirty row range for partial trail upload. Infinity/-1 = full upload. */
  private dirtyRowMin = Infinity;
  private dirtyRowMax = -1;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    trailTex: WebGLTexture,
    paletteTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.trailTex = trailTex;
    this.paletteTex = paletteTex;
    this.cpuTrailState = new Uint8Array(mapW * mapH);

    const palW = getPaletteSize();
    // Two rows: row 0 = base color + effect id, row 1 = second color (gradient).
    this.trailStyleCpu = new Uint8Array(palW * 4 * 2);
    this.trailStyleTex = createTexture2D(gl, {
      width: palW,
      height: 2,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: this.trailStyleCpu,
      filter: gl.NEAREST,
    });

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(trailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
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
    gl.uniform1i(gl.getUniformLocation(this.program, "uTrailStyle"), 3);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /**
   * Set a player's trail cosmetic style. `effectId` is 0 (none, falls back to
   * the palette color), 1 (solid), 2 (rainbow), 3 (pulse), or 4 (gradient).
   * r/g/b (0–255) are the base color (solid/pulse/gradient); r2/g2/b2 are the
   * second color (gradient only). Uploads the whole texture — only called when
   * a player first appears, so the cost is negligible.
   */
  setPlayerTrailStyle(
    smallID: number,
    r: number,
    g: number,
    b: number,
    effectId: number,
    r2: number,
    g2: number,
    b2: number,
  ): void {
    const palW = getPaletteSize();
    const off = smallID * 4;
    this.trailStyleCpu[off] = r;
    this.trailStyleCpu[off + 1] = g;
    this.trailStyleCpu[off + 2] = b;
    this.trailStyleCpu[off + 3] = effectId;
    const off2 = palW * 4 + smallID * 4;
    this.trailStyleCpu[off2] = r2;
    this.trailStyleCpu[off2 + 1] = g2;
    this.trailStyleCpu[off2 + 2] = b2;
    this.trailStyleCpu[off2 + 3] = 0;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.trailStyleTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      palW,
      2,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.trailStyleCpu,
    );
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  // ---------------------------------------------------------------------------
  // Trail data upload
  // ---------------------------------------------------------------------------

  /** Live-game path: reference the game's own trail array directly. */
  setLiveRef(trailState: Uint8Array): void {
    this.liveTrailRef = trailState;
    this.trailsDirty = true;
  }

  /** Live trail delta: update live ref + accept dirty row range from TrailManager. */
  applyLiveDelta(
    trailState: Uint8Array,
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
    const gl = this.gl;
    const src = this.liveTrailRef ?? this.cpuTrailState;
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
        gl.UNSIGNED_BYTE,
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
        gl.UNSIGNED_BYTE,
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

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTrailAlpha, this.settings.mapOverlay.trailAlpha);
    gl.uniform1f(this.uTime, performance.now() / 1000);
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
    gl.bindTexture(gl.TEXTURE_2D, this.trailStyleTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.trailStyleTex);
  }
}
