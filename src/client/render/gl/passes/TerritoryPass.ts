/**
 * TerritoryPass — territory fill + fallout charcoal ground.
 *
 * Draws only what should be darkened by the night cycle:
 *   - Owned territory (player color fill)
 *   - Unowned fallout (charcoal ground)
 *
 * No borders, embers, trails, or defense checkerboard — those are
 * handled by BorderStampPass and TrailPass at full brightness.
 *
 * Also owns the CPU-side tile and trail state, flushing to shared
 * GPU textures on draw.
 */

import type { TilePair } from "../../types";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { OWNER_MASK, TILE_DEFINES } from "../utils/TileCodec";
import { UserSettings } from "../../../../core/game/UserSettings";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import territoryFragSrc from "../shaders/map-overlay/territory.frag.glsl?raw";

export class TerritoryPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private userSettings = new UserSettings();
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uCharcoalBase: WebGLUniformLocation;
  private uCharcoalVariation: WebGLUniformLocation;
  private uCharcoalAlpha: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightBrighten: WebGLUniformLocation;
  private uShowPatterns: WebGLUniformLocation;
  private highlightOwner = 0;

  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private trailTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;

  private altView = false;

  /** CPU-side tile state (deltas written here, flushed to GPU before draw). */
  private cpuTileState: Uint16Array;
  private tilesDirty = false;

  /** CPU-side trail state (R8UI, 0=none, 1–255=ownerID). */
  private cpuTrailState: Uint8Array;
  private trailsDirty = false;

  /** Live-game references — bypasses memcpy. Null for replay path. */
  private liveTileRef: Uint16Array | null = null;
  private liveTrailRef: Uint8Array | null = null;

  /** Dirty row range for partial tile upload. Infinity/-1 = full upload. */
  private dirtyRowMin = Infinity;
  private dirtyRowMax = -1;

  /** Dirty row range for partial trail upload. Infinity/-1 = full upload. */
  private trailDirtyRowMin = Infinity;
  private trailDirtyRowMax = -1;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    trailTex: WebGLTexture,
    paletteTex: WebGLTexture,
    patternMetaTex: WebGLTexture,
    patternDataTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.trailTex = trailTex;
    this.paletteTex = paletteTex;
    this.patternMetaTex = patternMetaTex;
    this.patternDataTex = patternDataTex;
    this.cpuTileState = new Uint16Array(mapW * mapH);
    this.cpuTrailState = new Uint8Array(mapW * mapH);

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
    this.uCharcoalBase = gl.getUniformLocation(this.program, "uCharcoalBase")!;
    this.uCharcoalVariation = gl.getUniformLocation(
      this.program,
      "uCharcoalVariation",
    )!;
    this.uCharcoalAlpha = gl.getUniformLocation(
      this.program,
      "uCharcoalAlpha",
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

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternMeta"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternData"), 3);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  // ---------------------------------------------------------------------------
  // Tile data upload
  // ---------------------------------------------------------------------------

  /** Full tile state upload (on seek). */
  uploadFullTileState(tileState: Uint16Array): void {
    this.liveTileRef = null;
    this.cpuTileState.set(tileState);
    this.tilesDirty = true;
  }

  /** Live-game path: reference the game's own arrays directly. */
  setLiveRefs(tileState: Uint16Array, trailState: Uint8Array): void {
    this.liveTileRef = tileState;
    this.liveTrailRef = trailState;
    this.tilesDirty = true;
    this.trailsDirty = true;
  }

  /** Apply tile deltas (during playback). */
  uploadDeltaTiles(changedTiles: TilePair[]): void {
    const ts = this.cpuTileState;
    for (let i = 0; i < changedTiles.length; i++) {
      const tp = changedTiles[i];
      ts[tp.ref] = tp.state;
    }
    this.tilesDirty = true;
  }

  /** Live delta: update live ref + compute dirty row range from deltas. */
  applyLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void {
    this.liveTileRef = tileState;
    let minRow = Infinity,
      maxRow = -1;
    for (let i = 0; i < changedTiles.length; i++) {
      const row = (changedTiles[i].ref / this.mapW) | 0;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
    if (maxRow >= 0) {
      this.dirtyRowMin = Math.min(this.dirtyRowMin, minRow);
      this.dirtyRowMax = Math.max(this.dirtyRowMax, maxRow);
    }
    this.tilesDirty = true;
  }

  /** Live trail delta: update live ref + accept dirty row range from TrailManager. */
  applyLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void {
    this.liveTrailRef = trailState;
    if (dirtyRowMax >= 0) {
      this.trailDirtyRowMin = Math.min(this.trailDirtyRowMin, dirtyRowMin);
      this.trailDirtyRowMax = Math.max(this.trailDirtyRowMax, dirtyRowMax);
    }
    this.trailsDirty = true;
  }

  /** Full trail state upload (on seek). */
  uploadFullTrailState(trailState: Uint8Array): void {
    this.liveTrailRef = null;
    this.cpuTrailState.set(trailState);
    this.trailsDirty = true;
  }

  /** Set a single trail tile (during playback advance). */
  setTrailTile(ref: number, ownerID: number): void {
    this.cpuTrailState[ref] = ownerID;
    this.trailsDirty = true;
  }

  /** Clear all trails (on seek before rebuilding). */
  clearTrails(): void {
    this.cpuTrailState.fill(0);
    this.trailsDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get ownerID at a tile reference. Returns 0 for unowned. */
  getOwnerAt(tileRef: number): number {
    const ts = this.liveTileRef ?? this.cpuTileState;
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
    const ts = this.liveTileRef ?? this.cpuTileState;
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
    const src = this.liveTileRef ?? this.cpuTileState;
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

  /** Flush trail texture to GPU (called before TrailPass draws). */
  flushTrailTexture(): void {
    if (!this.trailsDirty) return;
    const gl = this.gl;
    const src = this.liveTrailRef ?? this.cpuTrailState;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);

    if (this.trailDirtyRowMax >= 0) {
      // Partial upload — only dirty rows
      const minRow = this.trailDirtyRowMin;
      const rowCount = this.trailDirtyRowMax - minRow + 1;
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

    this.trailDirtyRowMin = Infinity;
    this.trailDirtyRowMax = -1;
    this.trailsDirty = false;
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  /** Set the hovered player's smallID for territory-fill brightening (0 = off). */
  setHighlightOwner(ownerID: number): void {
    this.highlightOwner = ownerID;
  }

  /** Draw territory fill + fallout charcoal. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    this.flushTileTexture();
    this.flushTrailTexture();

    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uCharcoalBase, mo.charcoalBase);
    gl.uniform1f(this.uCharcoalVariation, mo.charcoalVariation);
    gl.uniform1f(this.uCharcoalAlpha, mo.charcoalAlpha);
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1f(this.uHighlightBrighten, mo.highlightFillBrighten);
    gl.uniform1i(
      this.uShowPatterns,
      this.settings.passEnabled.territoryPatterns &&
        this.userSettings.territoryPatterns()
        ? 1
        : 0,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // tileTex, trailTex, paletteTex owned by GPUResources / renderer
  }
}
