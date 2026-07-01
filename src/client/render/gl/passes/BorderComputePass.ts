/**
 * BorderComputePass — tile-resolution pass that computes per-tile border flags.
 *
 * Runs a fullscreen quad at tile resolution (mapW × mapH) and writes to an
 * RGBA8 texture:
 *   R = border type: 0 = interior, 0.5 = normal border, 1.0 = highlight border
 *   G = unused (was ember intensity — moved to FalloutBloomPass/FalloutLightPass)
 *   B = unused (was defense proximity — now computed per-tile by DefenseCoveragePass)
 *
 * Both MapOverlayPass (daytime) and the night stamp overlay read this buffer
 * instead of independently computing neighbor checks. Border thickening is
 * computed once here via an N-tile Chebyshev radius expansion.
 */

import type { RenderSettings } from "../RenderSettings";
import borderComputeFragSrc from "../shaders/border-compute/border-compute.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";
import {
  createFullscreenQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";
import { BorderScatterPass } from "./BorderScatterPass";

/** Max player smallID supported by the relationship texture. */
const RELATION_TEX_SIZE = 1024;

// ---------------------------------------------------------------------------
// BorderComputePass
// ---------------------------------------------------------------------------

export class BorderComputePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private borderTex: WebGLTexture;
  private borderFbo: WebGLFramebuffer;
  private mapW: number;
  private mapH: number;

  private relationTex: WebGLTexture;

  private uMapSize: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightThicken: WebGLUniformLocation;

  private highlightOwner = 0;
  /**
   * True when something that affects ALL borders (highlight owner, relation
   * matrix) has changed since the last draw. Forces a full recompute next
   * frame. Starts true so the first frame computes.
   */
  private globalDirty = true;

  /** Incremental per-tile recompute. Used between full recomputes. */
  private scatter!: BorderScatterPass;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;

    this.program = createProgram(
      gl,
      fullscreenNoUvVertSrc,
      shaderSrc(borderComputeFragSrc, { ...TILE_DEFINES }),
    );

    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uHighlightOwner = gl.getUniformLocation(
      this.program,
      "uHighlightOwner",
    )!;
    this.uHighlightThicken = gl.getUniformLocation(
      this.program,
      "uHighlightThicken",
    )!;

    // Texture unit binding
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uRelationTex"), 1);

    // --- Relationship texture (R8UI, RELATION_TEX_SIZE × RELATION_TEX_SIZE) ---
    this.relationTex = createTexture2D(gl, {
      width: RELATION_TEX_SIZE,
      height: RELATION_TEX_SIZE,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    // --- RGBA8 border buffer at tile resolution ---
    // R = border type, G = unused, B = defense proximity flag
    this.borderTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });

    // FBO
    this.borderFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.borderFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.borderTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Fullscreen quad VAO [0,1]
    this.vao = createFullscreenQuad(gl);

    // Store tileTex reference for binding
    this._tileTex = tileTex;

    this.scatter = new BorderScatterPass(
      gl,
      mapW,
      mapH,
      this.borderTex,
      tileTex,
      this.relationTex,
      settings,
    );
  }

  private _tileTex: WebGLTexture;

  /** Set the highlighted player's ownerID (0 = no highlight). */
  setHighlightOwner(ownerID: number): void {
    if (ownerID === this.highlightOwner) return;
    this.highlightOwner = ownerID;
    this.scatter.setHighlightOwner(ownerID);
    this.globalDirty = true;
  }

  /**
   * Upload a relationship matrix (R8UI, size × size).
   * Values: 0 = neutral, 1 = friendly, 2 = embargo.
   * Indexed by [ownerA, ownerB]. Size must be ≤ RELATION_TEX_SIZE.
   */
  updateRelations(data: Uint8Array, size: number): void {
    const gl = this.gl;
    const s = Math.min(size, RELATION_TEX_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, this.relationTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      s,
      s,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      data,
    );
    this.globalDirty = true;
  }

  /**
   * Force a full recompute next draw. Use this when tile state has been
   * replaced wholesale (initial load, seek) — individual `patchTile` calls
   * would be too many to be cheaper than rebuilding the whole map.
   */
  markGlobalDirty(): void {
    this.globalDirty = true;
  }

  /**
   * Notify that one tile changed owner (from `prevOwner` to `newOwner`).
   * Schedules incremental border recompute for that tile + its 4 cardinal
   * neighbors — or, when the change touches the highlighted owner, a wider box
   * so the highlight band's inner edge keeps up. Cheap: ~5 points per call in
   * the common case. Caller is responsible for ensuring tileTex contains the
   * new state before the next draw — TerritoryPass.flushTileTexture takes care
   * of that.
   */
  patchTile(x: number, y: number, prevOwner: number, newOwner: number): void {
    this.scatter.pushWithNeighbors(x, y, prevOwner, newOwner);
  }

  /** The border buffer texture (RG8, tile resolution). */
  getBorderTex(): WebGLTexture {
    return this.borderTex;
  }

  /**
   * Update border flags for the current frame. Either a full recompute (when
   * globalDirty is set by highlight/relation changes) or a scatter of the
   * per-tile patches queued via `patchTile`.
   *
   * Exit GL state:
   *   - Full recompute path: `borderFbo` is still bound; viewport at map size.
   *   - Scatter path: default framebuffer bound; viewport at map size.
   *   - No-op path: state unchanged.
   * Caller must restore both framebuffer and viewport before subsequent draws.
   */
  draw(): void {
    if (this.globalDirty) {
      this.globalDirty = false;
      this.scatter.clear(); // full recompute supersedes any queued patches

      const gl = this.gl;
      const mo = this.settings.mapOverlay;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.borderFbo);
      gl.viewport(0, 0, this.mapW, this.mapH);
      gl.disable(gl.BLEND);

      gl.useProgram(this.program);
      gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
      gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
      gl.uniform1i(this.uHighlightThicken, Math.floor(mo.highlightThicken));

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._tileTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.relationTex);

      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else if (this.scatter.count > 0) {
      this.scatter.flush();
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.borderTex);
    gl.deleteTexture(this.relationTex);
    gl.deleteFramebuffer(this.borderFbo);
    this.scatter.dispose();
  }
}
