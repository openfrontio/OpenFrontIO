/**
 * BorderComputePass — tile-resolution pass that computes per-tile border flags.
 *
 * Runs a fullscreen quad at tile resolution (mapW × mapH) and writes to an
 * RGBA8 texture:
 *   R = border type: 0 = interior, 0.5 = normal border, 1.0 = highlight border
 *   G = unused (was ember intensity — moved to FalloutBloomPass/FalloutLightPass)
 *   B = defense proximity: 1.0 if border tile is within range of same-owner defense post
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

const MAX_DEFENSE_POSTS = 64;

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
  private uDefensePosts: WebGLUniformLocation;
  private uDefensePostCount: WebGLUniformLocation;
  private uDefensePostRange: WebGLUniformLocation;

  private highlightOwner = 0;
  /** True when any input has changed since last draw. Starts true so first frame computes. */
  private dirty = true;

  /** Packed defense post data: [x, y, ownerID, 0, x, y, ownerID, 0, ...] */
  private defensePostData = new Float32Array(MAX_DEFENSE_POSTS * 4);
  private defensePostCount = 0;

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
      shaderSrc(borderComputeFragSrc, { ...TILE_DEFINES, MAX_DEFENSE_POSTS }),
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
    this.uDefensePosts = gl.getUniformLocation(this.program, "uDefensePosts")!;
    this.uDefensePostCount = gl.getUniformLocation(
      this.program,
      "uDefensePostCount",
    )!;
    this.uDefensePostRange = gl.getUniformLocation(
      this.program,
      "uDefensePostRange",
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
  }

  private _tileTex: WebGLTexture;

  /** Set the highlighted player's ownerID (0 = no highlight). */
  setHighlightOwner(ownerID: number): void {
    if (ownerID === this.highlightOwner) return;
    this.highlightOwner = ownerID;
    this.dirty = true;
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
    this.dirty = true;
  }

  /** Update defense post positions for checkerboard proximity. */
  updateDefensePosts(posts: { x: number; y: number; ownerID: number }[]): void {
    const count = Math.min(posts.length, MAX_DEFENSE_POSTS);
    const data = this.defensePostData;
    for (let i = 0; i < count; i++) {
      const p = posts[i];
      const off = i * 4;
      data[off] = p.x;
      data[off + 1] = p.y;
      data[off + 2] = p.ownerID;
      data[off + 3] = 0;
    }
    this.defensePostCount = count;
    this.dirty = true;
  }

  /** Notify that the tile texture has been updated (ownership may have changed). */
  notifyTilesChanged(): void {
    this.dirty = true;
  }

  /** The border buffer texture (RG8, tile resolution). */
  getBorderTex(): WebGLTexture {
    return this.borderTex;
  }

  /**
   * Compute border flags for the current frame. Call before MapOverlayPass and stamp overlay.
   * Leaves the GL state with its own FBO bound — caller must restore FBO and viewport.
   */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.borderFbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1i(this.uHighlightThicken, Math.floor(mo.highlightThicken));
    gl.uniform4fv(this.uDefensePosts, this.defensePostData);
    gl.uniform1i(this.uDefensePostCount, this.defensePostCount);
    gl.uniform1f(this.uDefensePostRange, mo.defensePostRange);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.relationTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.borderTex);
    gl.deleteTexture(this.relationTex);
    gl.deleteFramebuffer(this.borderFbo);
  }
}
