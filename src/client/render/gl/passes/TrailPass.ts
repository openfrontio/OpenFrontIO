/**
 * TrailPass — boat + nuke trail lines.
 *
 * Owns the dirty-row bookkeeping for partial GPU uploads and the trail
 * fragment shader that draws the colored breadcrumb behind moving units.
 * Trail state itself (R16UI: 0=none, bits 0-11=ownerID, bit 12=nuke trail)
 * is referenced from the caller's array, not copied.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize, MAX_TRAIL_COLORS } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";
import { TileScatterPass } from "./TileScatterPass";

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
  private effectTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;
  private scatter: TileScatterPass;
  // Anchor animation time at construction (like NukeTelegraphPass/SamRadiusPass)
  // so the value stays small and sin()/fract() don't quantize over long sessions.
  private readonly startTime = performance.now();

  private trailsDirty = false;

  /**
   * Reference to the caller-owned trail state (R16UI: 0=none, owner in bits
   * 0-11, nuke bit 12). Every upload entry point provides it, so the pass
   * keeps no copy of its own; the caller's array must stay current until the
   * flush. Null until the first upload.
   */
  private liveTrailRef: Uint16Array | null = null;

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
    this.scatter = new TileScatterPass(gl, mapW, mapH, trailTex);

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(trailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        MAX_TRAIL_COLORS,
        ...TILE_DEFINES,
      }),
      "TrailPass",
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

    this.vao = createMapQuad(gl, mapW, mapH);
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
  setLiveRef(trailState: Uint16Array): void {
    this.liveTrailRef = trailState;
    this.trailsDirty = true;
    this.dirtyRowMin = Infinity;
    this.dirtyRowMax = -1;
    this.scatter.clear();
  }

  /** Live trail delta: update live ref + accept dirty row range or tile list from TrailManager. */
  applyLiveDelta(
    trailState: Uint16Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
    changedTiles?: readonly number[],
  ): void {
    this.liveTrailRef = trailState;
    const isFullUploadPending = this.trailsDirty && this.dirtyRowMax < 0;
    const isRowUploadPending = this.dirtyRowMax >= 0;

    // Sparse scatter path only runs when no full or row upload is already pending;
    // a pending upload already covers the full or row state.
    if (
      !isFullUploadPending &&
      !isRowUploadPending &&
      changedTiles &&
      changedTiles.length > 0 &&
      changedTiles.length < 8192
    ) {
      for (let i = 0; i < changedTiles.length; i++) {
        const ref = changedTiles[i];
        const x = ref % this.mapW;
        const y = (ref - x) / this.mapW;
        this.scatter.push(x, y, trailState[ref]);
      }
      this.trailsDirty = true;
      return;
    }

    // A row or full upload supersedes any sparse scatter points.
    this.scatter.clear();
    if (dirtyRowMax >= 0) {
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

    if (this.scatter.count > 0) {
      this.scatter.flush();
      this.trailsDirty = false;
      this.dirtyRowMin = Infinity;
      this.dirtyRowMax = -1;
      return;
    }

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
        gl.UNSIGNED_SHORT,
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
        gl.UNSIGNED_SHORT,
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
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    this.scatter.dispose();
  }
}
