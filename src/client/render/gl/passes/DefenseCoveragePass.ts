/**
 * DefenseCoveragePass — per-tile "is this tile defended by a same-owner Defense
 * Post?" flag, computed by stamping one instanced circle per post.
 *
 * Replaces the old per-fragment scan (border-compute looped over a uniform array
 * of up to 64 posts for every border tile). Here we invert the loop: each post
 * draws a filled circle of its range into a map-resolution R8 texture, writing
 * 1.0 on tiles it owns and within range. Cost is O(posts × circle area) with no
 * cap on post count, and it's a single instanced draw call regardless of how
 * many posts exist — the same pattern UnitPass/StructurePass already use.
 *
 * BorderStampPass samples the resulting `coverageTex` (one texel per border
 * tile) instead of the old uniform loop. The texture marks every same-owner
 * in-range tile, interior included — so a future PR can darken the territory
 * fill by sampling the same texture in TerritoryPass.
 *
 * The result depends on tile ownership (the same-owner test), so coverage must
 * be re-stamped whenever posts OR territory change. Territory drips every frame
 * during combat, so a full map re-stamp every frame would be wasteful at high
 * post counts. Instead we track a grid of dirty BLOCKs: a tile changing owner
 * only changes its own coverage, so we recompute just the blocks containing
 * changed tiles, scissored to each block (clear the block, redraw the posts —
 * the scissor confines the GPU work to the changed region). A post add/remove
 * or full tile upload sets `fullDirty` for one whole-map stamp; if too many
 * blocks are dirty we fall back to a full stamp too.
 *
 * Exit GL state: default framebuffer bound; viewport left at map size; scissor
 * test disabled. The caller (Renderer.renderFrame) rebinds framebuffer +
 * viewport before screen draws.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import coverageFragSrc from "../shaders/defense-coverage/defense-coverage.frag.glsl?raw";
import coverageVertSrc from "../shaders/defense-coverage/defense-coverage.vert.glsl?raw";
import { createProgram, createTexture2D, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

/** Per-instance data (3 floats): tileX, tileY, ownerID. */
const FLOATS_PER_INSTANCE = 3;

/**
 * Tile block size for incremental scissored re-stamping. ~2× the post diameter
 * (range ≈ 30, so circles ≈ 60 wide): small enough to confine work to the
 * changed region, large enough to keep the per-block draw-call count low.
 */
const BLOCK = 128;

export class DefenseCoveragePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;
  private tileTex: WebGLTexture;

  private program: WebGLProgram;
  private uMapSize: WebGLUniformLocation;
  private uRange: WebGLUniformLocation;

  private coverageTex: WebGLTexture;
  private fbo: WebGLFramebuffer;

  private quadBuf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private count = 0;

  // --- Dirty tracking (block grid) ---
  private blocksX: number;
  private blocksY: number;
  /** Re-stamp the whole map next draw. Starts true so the first frame computes. */
  private fullDirty = true;
  /** Per-block dirty flag (0/1), indexed by blockY * blocksX + blockX. */
  private dirtyBlock: Uint8Array;
  /** Indices of currently-dirty blocks (to iterate + reset without scanning). */
  private dirtyList: number[] = [];
  /** Above this many dirty blocks, a single full stamp is cheaper. */
  private fullFallback: number;

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
    this.tileTex = tileTex;

    this.blocksX = Math.ceil(mapW / BLOCK);
    this.blocksY = Math.ceil(mapH / BLOCK);
    this.dirtyBlock = new Uint8Array(this.blocksX * this.blocksY);
    // Past ~half the blocks, one full stamp beats many scissored block draws.
    this.fullFallback = Math.floor((this.blocksX * this.blocksY) / 2);

    this.program = createProgram(
      gl,
      coverageVertSrc,
      shaderSrc(coverageFragSrc, { OWNER_MASK: TILE_DEFINES.OWNER_MASK }),
    );
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uRange = gl.getUniformLocation(this.program, "uRange")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);

    // --- R8 coverage texture at tile resolution + its FBO ---
    this.coverageTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: null,
      filter: gl.NEAREST,
    });
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.coverageTex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- Shared unit quad [0,1]² ---
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    // --- Per-post instance buffer + VAO ---
    const instGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instGlBuf,
      256,
      FLOATS_PER_INSTANCE,
    );
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instGlBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  /** Replace the set of defense posts. No cap. */
  updateDefensePosts(posts: { x: number; y: number; ownerID: number }[]): void {
    this.count = posts.length;
    this.instanceBuf.ensureCapacity(posts.length);
    const f = this.instanceBuf.float32;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const off = i * FLOATS_PER_INSTANCE;
      f[off] = p.x;
      f[off + 1] = p.y;
      f[off + 2] = p.ownerID;
    }
    if (posts.length > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        posts.length * FLOATS_PER_INSTANCE,
      );
    }
    // A post appearing/disappearing affects its whole circle (possibly several
    // blocks); post-set changes are rare, so just re-stamp the whole map.
    this.fullDirty = true;
  }

  /**
   * Mark the block containing tile (x, y) stale. Call when a tile changed owner
   * — the same-owner test means only that tile's own coverage can flip, so just
   * its block needs recomputing. Coalesced: the block is re-stamped once in the
   * next draw() regardless of how many of its tiles changed.
   */
  markTileDirty(x: number, y: number): void {
    const bx = (x / BLOCK) | 0;
    const by = (y / BLOCK) | 0;
    const b = by * this.blocksX + bx;
    if (this.dirtyBlock[b] === 0) {
      this.dirtyBlock[b] = 1;
      this.dirtyList.push(b);
    }
  }

  /** Force a whole-map re-stamp next draw (full tile upload / seek). */
  markDirty(): void {
    this.fullDirty = true;
  }

  /** The R8 coverage texture (1.0 = tile is defended by a same-owner post). */
  getCoverageTex(): WebGLTexture {
    return this.coverageTex;
  }

  /**
   * Re-stamp coverage if anything changed. Either a whole-map stamp (fullDirty,
   * or too many blocks dirty) or a scissored clear+stamp per dirty block.
   *
   * Exit GL state: default framebuffer bound; scissor test disabled; viewport
   * left at map size (caller resets before screen draws).
   */
  draw(): void {
    if (!this.fullDirty && this.dirtyList.length === 0) return;

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    // Shared stamp state (uniforms/textures/VAO don't change between blocks).
    gl.useProgram(this.program);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uRange, this.settings.mapOverlay.defensePostRange);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.bindVertexArray(this.vao);

    if (this.fullDirty || this.dirtyList.length > this.fullFallback) {
      // Whole-map stamp.
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (this.count > 0)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    } else {
      // Per-block scissored stamp — confines clear + draw to changed regions.
      gl.enable(gl.SCISSOR_TEST);
      for (const b of this.dirtyList) {
        const bx = (b % this.blocksX) * BLOCK;
        const by = ((b / this.blocksX) | 0) * BLOCK;
        // Tile coords map 1:1 to FBO pixels (no Y flip), so pass the block rect
        // straight to scissor, clamping the right/bottom edge blocks to bounds.
        const bw = Math.min(BLOCK, this.mapW - bx);
        const bh = Math.min(BLOCK, this.mapH - by);
        gl.scissor(bx, by, bw, bh);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (this.count > 0) {
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
        }
      }
      gl.disable(gl.SCISSOR_TEST);
    }

    // Reset dirty state.
    for (const b of this.dirtyList) this.dirtyBlock[b] = 0;
    this.dirtyList.length = 0;
    this.fullDirty = false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.coverageTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.vao);
    this.instanceBuf.dispose();
  }
}
