/**
 * TerritoryPass — territory fill + stale-nuke ground.
 *
 * Draws only what should be darkened by the night cycle:
 *   - Owned territory (player color fill)
 *   - Any fallout tile (stale-nuke ground, overrides owned territory)
 *
 * No borders, embers, trails, or defense checkerboard — those are
 * handled by BorderStampPass and TrailPass at full brightness.
 *
 * Owns the CPU-side tile state and the drip queue that staggers tile
 * uploads across render frames.
 */

import type { TilePair } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { OWNER_MASK, TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import territoryFragSrc from "../shaders/map-overlay/territory.frag.glsl?raw";

export class TerritoryPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uStaleNukeBase: WebGLUniformLocation;
  private uStaleNukeVariation: WebGLUniformLocation;
  private uStaleNukeAlpha: WebGLUniformLocation;
  private uStaleNukeColor: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightBrighten: WebGLUniformLocation;
  private uShowPatterns: WebGLUniformLocation;
  private uIsTeamMode: WebGLUniformLocation;
  private highlightOwner = 0;
  private isTeamMode = false;

  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;
  private skinAtlasTex: WebGLTexture;
  private skinLayerTex: WebGLTexture;
  private skinAnchorTex: WebGLTexture;

  private altView = false;
  private showPatterns = true;

  /** CPU-side tile state — what is currently on the GPU (display state). */
  private cpuTileState: Uint16Array;
  private tilesDirty = false;

  /** Dirty row range for partial tile upload. Infinity/-1 = full upload. */
  private dirtyRowMin = Infinity;
  private dirtyRowMax = -1;

  /**
   * Drip buckets — round-robin staggering of tile updates across render frames.
   * Each incoming change is hashed by tile ref to a fixed bucket (stable hash
   * preserves per-tile ordering across ticks). One bucket drains per render
   * frame, giving a ~bucketCount-frame buffer that smooths over network jitter.
   *
   * Each bucket is a flat number[] with interleaved [ref, state, ref, state, …]
   * pairs — avoids per-tile object allocation on the hot push path.
   */
  private readonly nBuckets: number;
  private dripBuckets: number[][] = [];
  private currentBucket = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    patternMetaTex: WebGLTexture,
    patternDataTex: WebGLTexture,
    skinAtlasTex: WebGLTexture,
    skinLayerTex: WebGLTexture,
    skinAnchorTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.patternMetaTex = patternMetaTex;
    this.patternDataTex = patternDataTex;
    this.skinAtlasTex = skinAtlasTex;
    this.skinLayerTex = skinLayerTex;
    this.skinAnchorTex = skinAnchorTex;
    this.cpuTileState = new Uint16Array(mapW * mapH);

    this.nBuckets = Math.max(1, settings.tileDrip.bucketCount | 0);
    for (let i = 0; i < this.nBuckets; i++) this.dripBuckets.push([]);

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(territoryFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uStaleNukeBase = gl.getUniformLocation(
      this.program,
      "uStaleNukeBase",
    )!;
    this.uStaleNukeVariation = gl.getUniformLocation(
      this.program,
      "uStaleNukeVariation",
    )!;
    this.uStaleNukeAlpha = gl.getUniformLocation(
      this.program,
      "uStaleNukeAlpha",
    )!;
    this.uStaleNukeColor = gl.getUniformLocation(
      this.program,
      "uStaleNukeColor",
    )!;
    this.uHighlightOwner = gl.getUniformLocation(
      this.program,
      "uHighlightOwner",
    )!;
    this.uHighlightBrighten = gl.getUniformLocation(
      this.program,
      "uHighlightBrighten",
    )!;
    this.uShowPatterns = gl.getUniformLocation(this.program, "uShowPatterns")!;
    this.uIsTeamMode = gl.getUniformLocation(this.program, "uIsTeamMode")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternMeta"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternData"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAtlas"), 4);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinLayer"), 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAnchor"), 6);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  // ---------------------------------------------------------------------------
  // Tile data upload
  // ---------------------------------------------------------------------------

  /** Full tile state upload (on seek). */
  uploadFullTileState(tileState: Uint16Array): void {
    this.cpuTileState.set(tileState);
    this.clearDripBuckets();
    this.dirtyRowMin = Infinity;
    this.dirtyRowMax = -1;
    this.tilesDirty = true;
  }

  /** Live-game path: snapshot the initial tile state and clear pending drip. */
  setLiveRef(tileState: Uint16Array): void {
    this.cpuTileState.set(tileState);
    this.clearDripBuckets();
    this.dirtyRowMin = Infinity;
    this.dirtyRowMax = -1;
    this.tilesDirty = true;
  }

  /** Apply tile deltas (during playback). */
  uploadDeltaTiles(changedTiles: TilePair[]): void {
    const ts = this.cpuTileState;
    const w = this.mapW;
    for (let i = 0; i < changedTiles.length; i++) {
      const tp = changedTiles[i];
      ts[tp.ref] = tp.state;
      const row = (tp.ref / w) | 0;
      if (row < this.dirtyRowMin) this.dirtyRowMin = row;
      if (row > this.dirtyRowMax) this.dirtyRowMax = row;
    }
    this.tilesDirty = true;
  }

  /**
   * Live delta: dispatch each changed tile into a round-robin drip bucket.
   * Stable per-ref hash means repeated updates to the same tile stay in
   * arrival order in the same bucket — last write wins when drained.
   */
  applyLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    const N = this.nBuckets;
    const buckets = this.dripBuckets;
    for (let i = 0; i < changedTiles.length; i++) {
      const ref = changedTiles[i].ref;
      const b = ((ref * 2654435761) >>> 0) % N;
      buckets[b].push(ref, tileState[ref]);
    }
  }

  /** Drain one drip bucket into cpuTileState. Called once per render frame. */
  drainDripBucket(): void {
    const bucket = this.dripBuckets[this.currentBucket];
    if (bucket.length > 0) {
      const isFullUploadPending = this.tilesDirty && this.dirtyRowMax < 0;

      if (isFullUploadPending) {
        // Full upload pending: skip tracking dirty rows, just flush data
        for (let i = 0; i < bucket.length; i += 2) {
          this.cpuTileState[bucket[i]] = bucket[i + 1];
        }
      } else {
        const w = this.mapW;
        let minRow = this.dirtyRowMin;
        let maxRow = this.dirtyRowMax;
        for (let i = 0; i < bucket.length; i += 2) {
          const ref = bucket[i];
          this.cpuTileState[ref] = bucket[i + 1];
          const row = (ref / w) | 0;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
        }
        this.dirtyRowMin = minRow;
        this.dirtyRowMax = maxRow;
      }

      bucket.length = 0;
      this.tilesDirty = true;
    }
    this.currentBucket = (this.currentBucket + 1) % this.nBuckets;
  }

  /**
   * Drain every drip bucket immediately. Used during spawn phase and after
   * seek so tile state pops to current sim state without the 60Hz stagger.
   */
  flushAllDripBuckets(): void {
    let any = false;
    const isFullUploadPending = this.tilesDirty && this.dirtyRowMax < 0;

    if (isFullUploadPending) {
      for (let b = 0; b < this.nBuckets; b++) {
        const bucket = this.dripBuckets[b];
        if (bucket.length === 0) continue;
        any = true;
        for (let i = 0; i < bucket.length; i += 2) {
          this.cpuTileState[bucket[i]] = bucket[i + 1];
        }
        bucket.length = 0;
      }
    } else {
      const w = this.mapW;
      let minRow = this.dirtyRowMin;
      let maxRow = this.dirtyRowMax;
      for (let b = 0; b < this.nBuckets; b++) {
        const bucket = this.dripBuckets[b];
        if (bucket.length === 0) continue;
        any = true;
        for (let i = 0; i < bucket.length; i += 2) {
          const ref = bucket[i];
          this.cpuTileState[ref] = bucket[i + 1];
          const row = (ref / w) | 0;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
        }
        bucket.length = 0;
      }
      this.dirtyRowMin = minRow;
      this.dirtyRowMax = maxRow;
    }

    if (any) {
      this.tilesDirty = true;
    }
  }

  private clearDripBuckets(): void {
    for (let b = 0; b < this.nBuckets; b++) this.dripBuckets[b].length = 0;
    this.currentBucket = 0;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Get ownerID at a tile reference. Returns 0 for unowned.
   * Reads display state (post-drip), so queries match what's visible.
   */
  getOwnerAt(tileRef: number): number {
    const ts = this.cpuTileState;
    if (tileRef < 0 || tileRef >= ts.length) return 0;
    return ts[tileRef] & OWNER_MASK;
  }

  /** AABB of all tiles owned by ownerID. */
  getBBoxForOwner(
    ownerID: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const w = this.mapW;
    const ts = this.cpuTileState;
    for (let i = 0; i < ts.length; i++) {
      if ((ts[i] & OWNER_MASK) === ownerID) {
        const x = i % w;
        const y = (i - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  // ---------------------------------------------------------------------------
  // GPU flush + draw
  // ---------------------------------------------------------------------------

  /** Flush tile texture to GPU early (before heat update reads it). Returns true if data was uploaded. */
  flushTileTexture(): boolean {
    if (!this.tilesDirty) return false;
    const gl = this.gl;
    const src = this.cpuTileState;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

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
      // Full upload (first tick, seek, replay full frame, etc.)
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
    this.tilesDirty = false;
    return true;
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  setShowPatterns(show: boolean): void {
    this.showPatterns = show;
  }

  /**
   * Update the skin atlas texture handle. Called once at game start after
   * the renderer learns the locked-in skin URL set.
   */
  setSkinAtlas(tex: WebGLTexture): void {
    this.skinAtlasTex = tex;
  }

  /** Whether this game has teams (controls skin tinting). */
  setTeamMode(isTeamMode: boolean): void {
    this.isTeamMode = isTeamMode;
  }

  /** Set the hovered player's smallID for territory-fill brightening (0 = off). */
  setHighlightOwner(ownerID: number): void {
    this.highlightOwner = ownerID;
  }

  /** Draw territory fill + stale-nuke ground. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    this.flushTileTexture();

    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uStaleNukeBase, mo.staleNukeBase);
    gl.uniform1f(this.uStaleNukeVariation, mo.staleNukeVariation);
    gl.uniform1f(this.uStaleNukeAlpha, mo.staleNukeAlpha);
    gl.uniform3f(
      this.uStaleNukeColor,
      mo.staleNukeR,
      mo.staleNukeG,
      mo.staleNukeB,
    );
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1f(this.uHighlightBrighten, mo.highlightFillBrighten);
    gl.uniform1i(
      this.uShowPatterns,
      this.settings.passEnabled.territoryPatterns && this.showPatterns ? 1 : 0,
    );
    gl.uniform1i(this.uIsTeamMode, this.isTeamMode ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skinAtlasTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.skinAnchorTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // tileTex, paletteTex, patternMetaTex, patternDataTex owned by GPUResources / renderer
  }
}
