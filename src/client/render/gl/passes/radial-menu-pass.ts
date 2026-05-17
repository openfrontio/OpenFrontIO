/**
 * RadialMenuPass — renders a radial (pie-wheel) context menu as screen-space
 * arc segments with emoji icons.
 *
 * Supports one level of submenus: when a submenu is open, the parent items
 * shrink into a smaller inner ring, a back button appears in the center, and
 * the submenu items take the outer ring.
 *
 * Rendering elements (reused for each ring via drawRing):
 *   1. Arcs: single quad with SDF annulus + angular segment masking + borders
 *   2. Center button: filled circle drawn by the innermost ring
 *   3. Icons: instanced quads sampling the emoji atlas
 */

import type { RadialMenuItem } from "../events";
import { createProgram } from "../utils/gl-utils";

import arcFragSrc from "../shaders/radial-menu/arcs.frag.glsl?raw";
import arcVertSrc from "../shaders/radial-menu/arcs.vert.glsl?raw";
import iconFragSrc from "../shaders/radial-menu/icon.frag.glsl?raw";
import iconVertSrc from "../shaders/radial-menu/icon.vert.glsl?raw";

import emojiAtlasMeta from "resources/atlases/emoji-atlas-meta.json";
import { assetUrl } from "src/core/AssetUrls";

const emojiAtlasUrl = assetUrl("atlases/emoji-atlas.png");

// ---------------------------------------------------------------------------
// Ring layout configs (CSS pixels)
// ---------------------------------------------------------------------------

interface RingConfig {
  outerR: number;
  innerR: number;
  /** Icon half-size; if a function, receives the segment count. */
  iconHalf: number | ((n: number) => number);
  /** Opacity multiplier applied to colors (1 = full, <1 = dimmed). */
  dim: number;
}

/** Normal top-level ring (game: innerRadius 40, arcWidth 55). */
const RING_NORMAL: RingConfig = {
  outerR: 95,
  innerR: 40,
  iconHalf: (n) => (n <= 4 ? 20 : n <= 6 ? 17 : 14),
  dim: 1.0,
};

/** Submenu active ring (game: innerRadius 75, arcWidth 65). */
const RING_SUBMENU: RingConfig = {
  outerR: 140,
  innerR: 75,
  iconHalf: (n) => (n <= 4 ? 22 : n <= 6 ? 18 : 14),
  dim: 1.0,
};

/** Parent ring when submenu is open (game: scales to 0.65). */
const RING_PARENT: RingConfig = {
  outerR: 70,
  innerR: 32,
  iconHalf: 12,
  dim: 0.5,
};
const MAX_SEGMENTS = 8;

/** Hit-test return value for the center button. */
export const CENTER_INDEX = -2;

const BACK_ITEM: RadialMenuItem = {
  id: "__back__",
  icon: "back-icon",
  color: [0.45, 0.45, 0.45],
  enabled: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEmojiMap(): Map<string, number> {
  const map = new Map<string, number>();
  const emojis = (emojiAtlasMeta as { emojis: Record<string, number> }).emojis;
  for (const [key, idx] of Object.entries(emojis)) {
    map.set(key, idx);
  }
  return map;
}

// ---------------------------------------------------------------------------
// RadialMenuPass
// ---------------------------------------------------------------------------

export class RadialMenuPass {
  private gl: WebGL2RenderingContext;

  // Programs
  private arcProg: WebGLProgram;
  private iconProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  // Arc uniform locations
  private arcU: {
    anchor: WebGLUniformLocation;
    viewport: WebGLUniformLocation;
    outerR: WebGLUniformLocation;
    innerR: WebGLUniformLocation;
    segCount: WebGLUniformLocation;
    hoveredSeg: WebGLUniformLocation;
    segColors: WebGLUniformLocation;
    hasCenterBtn: WebGLUniformLocation;
    centerColor: WebGLUniformLocation;
    centerHovered: WebGLUniformLocation;
  };

  // Icon uniform locations
  private iconU: {
    anchor: WebGLUniformLocation;
    viewport: WebGLUniformLocation;
    outerR: WebGLUniformLocation;
    innerR: WebGLUniformLocation;
    segCount: WebGLUniformLocation;
    iconHalf: WebGLUniformLocation;
    emojiIndices: WebGLUniformLocation;
    centerEmojiIdx: WebGLUniformLocation;
    segOpacity: WebGLUniformLocation;
    emojiAtlas: WebGLUniformLocation;
    emojiCell: WebGLUniformLocation;
    emojiCols: WebGLUniformLocation;
    emojiAtlasW: WebGLUniformLocation;
    emojiAtlasH: WebGLUniformLocation;
  };

  // Emoji + icon atlas
  private emojiTex: WebGLTexture | null = null;
  private emojiReady = false;
  private emojiMap: Map<string, number>;
  private atlasImg: HTMLImageElement | null = null;
  private pendingIcons: { key: string; img: CanvasImageSource }[] = [];

  // ---- State ----
  private visible = false;
  private anchorX = 0;
  private anchorY = 0;
  private items: RadialMenuItem[] = [];
  private centerItem: RadialMenuItem | null = null;
  private hoveredIndex = -1; // -1 = none, 0..n-1 = segment, CENTER_INDEX = center

  // Submenu (one level)
  private _inSubmenu = false;
  private savedItems: RadialMenuItem[] = [];
  private savedCenterItem: RadialMenuItem | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.emojiMap = buildEmojiMap();

    // Shared quad VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Arc program
    this.arcProg = createProgram(gl, arcVertSrc, arcFragSrc);
    this.arcU = {
      anchor: gl.getUniformLocation(this.arcProg, "uAnchor")!,
      viewport: gl.getUniformLocation(this.arcProg, "uViewport")!,
      outerR: gl.getUniformLocation(this.arcProg, "uOuterR")!,
      innerR: gl.getUniformLocation(this.arcProg, "uInnerR")!,
      segCount: gl.getUniformLocation(this.arcProg, "uSegCount")!,
      hoveredSeg: gl.getUniformLocation(this.arcProg, "uHoveredSeg")!,
      segColors: gl.getUniformLocation(this.arcProg, "uSegColors")!,
      hasCenterBtn: gl.getUniformLocation(this.arcProg, "uHasCenterBtn")!,
      centerColor: gl.getUniformLocation(this.arcProg, "uCenterColor")!,
      centerHovered: gl.getUniformLocation(this.arcProg, "uCenterHovered")!,
    };

    // Icon program
    this.iconProg = createProgram(gl, iconVertSrc, iconFragSrc);
    gl.useProgram(this.iconProg);
    gl.uniform1i(gl.getUniformLocation(this.iconProg, "uEmojiAtlas"), 0);
    const em = emojiAtlasMeta as {
      width: number;
      height: number;
      cellSize: number;
      cols: number;
    };
    gl.uniform1f(
      gl.getUniformLocation(this.iconProg, "uEmojiCell")!,
      em.cellSize,
    );
    gl.uniform1f(gl.getUniformLocation(this.iconProg, "uEmojiCols")!, em.cols);
    gl.uniform1f(
      gl.getUniformLocation(this.iconProg, "uEmojiAtlasW")!,
      em.width,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.iconProg, "uEmojiAtlasH")!,
      em.height,
    );

    this.iconU = {
      anchor: gl.getUniformLocation(this.iconProg, "uAnchor")!,
      viewport: gl.getUniformLocation(this.iconProg, "uViewport")!,
      outerR: gl.getUniformLocation(this.iconProg, "uOuterR")!,
      innerR: gl.getUniformLocation(this.iconProg, "uInnerR")!,
      segCount: gl.getUniformLocation(this.iconProg, "uSegCount")!,
      iconHalf: gl.getUniformLocation(this.iconProg, "uIconHalf")!,
      emojiIndices: gl.getUniformLocation(this.iconProg, "uEmojiIndices")!,
      centerEmojiIdx: gl.getUniformLocation(this.iconProg, "uCenterEmojiIdx")!,
      segOpacity: gl.getUniformLocation(this.iconProg, "uSegOpacity")!,
      emojiAtlas: gl.getUniformLocation(this.iconProg, "uEmojiAtlas")!,
      emojiCell: gl.getUniformLocation(this.iconProg, "uEmojiCell")!,
      emojiCols: gl.getUniformLocation(this.iconProg, "uEmojiCols")!,
      emojiAtlasW: gl.getUniformLocation(this.iconProg, "uEmojiAtlasW")!,
      emojiAtlasH: gl.getUniformLocation(this.iconProg, "uEmojiAtlasH")!,
    };

    this.loadEmojiAtlas();
  }

  private loadEmojiAtlas(): void {
    const img = new Image();
    img.onload = () => {
      this.atlasImg = img;
      this.rebuildAtlasTexture();
    };
    img.src = emojiAtlasUrl;
  }

  /**
   * Register additional icon images to append to the atlas texture.
   * Call from the adapter after loading game SVG icons.
   */
  registerIcons(icons: { key: string; img: CanvasImageSource }[]): void {
    this.pendingIcons = icons;
    if (this.atlasImg) this.rebuildAtlasTexture();
  }

  private rebuildAtlasTexture(): void {
    if (!this.atlasImg) return;

    const gl = this.gl;
    const meta = emojiAtlasMeta as {
      width: number;
      height: number;
      cellSize: number;
      cols: number;
      emojis: Record<string, number>;
    };
    const baseCount = Object.keys(meta.emojis).length;
    const totalCount = baseCount + this.pendingIcons.length;
    const rows = Math.ceil(totalCount / meta.cols);
    const height = Math.max(meta.height, rows * meta.cellSize);

    const canvas = document.createElement("canvas");
    canvas.width = meta.width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Draw existing emoji atlas
    ctx.drawImage(this.atlasImg, 0, 0);

    // Append extra icons into new cells (preserving aspect ratio)
    // Minimal padding — SVGs are already clean vectors, maximize resolution
    const pad = Math.floor(meta.cellSize * 0.04);
    const size = meta.cellSize - pad * 2;
    for (let i = 0; i < this.pendingIcons.length; i++) {
      const idx = baseCount + i;
      const col = idx % meta.cols;
      const row = Math.floor(idx / meta.cols);
      const img = this.pendingIcons[i].img;
      const nw = (img as HTMLImageElement).naturalWidth || size;
      const nh = (img as HTMLImageElement).naturalHeight || size;
      const aspect = nw / nh;
      let dw = size,
        dh = size;
      if (aspect > 1) dh = size / aspect;
      else dw = size * aspect;
      const ox = (size - dw) / 2;
      const oy = (size - dh) / 2;
      ctx.drawImage(
        img,
        col * meta.cellSize + pad + ox,
        row * meta.cellSize + pad + oy,
        dw,
        dh,
      );
      this.emojiMap.set(this.pendingIcons[i].key, idx);
    }

    // Upload texture
    this.emojiTex ??= gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.emojiTex);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.emojiReady = true;

    // Update atlas height uniform (texture may be taller now)
    gl.useProgram(this.iconProg);
    gl.uniform1f(this.iconU.emojiAtlasH, height);
  }

  resolveEmoji(icon: string): number {
    return this.emojiMap.get(icon) ?? -1;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  show(
    anchorX: number,
    anchorY: number,
    items: RadialMenuItem[],
    centerItem?: RadialMenuItem,
  ): void {
    this.visible = true;
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.items = items.slice(0, MAX_SEGMENTS);
    this.centerItem = centerItem ?? null;
    // Cursor is at the anchor — center button starts hovered
    this.hoveredIndex = this.centerItem ? CENTER_INDEX : -1;
    this._inSubmenu = false;
    this.savedItems = [];
    this.savedCenterItem = null;
  }

  openSubMenu(subItems: RadialMenuItem[]): void {
    this.savedItems = this.items;
    this.savedCenterItem = this.centerItem;
    this.items = subItems.slice(0, MAX_SEGMENTS);
    this.centerItem = BACK_ITEM;
    this._inSubmenu = true;
    this.hoveredIndex = -1;
  }

  goBack(): void {
    if (!this._inSubmenu) return;
    this.items = this.savedItems;
    this.centerItem = this.savedCenterItem;
    this._inSubmenu = false;
    this.savedItems = [];
    this.savedCenterItem = null;
    this.hoveredIndex = -1;
  }

  hide(): void {
    this.visible = false;
    this.hoveredIndex = -1;
    this._inSubmenu = false;
    this.savedItems = [];
    this.savedCenterItem = null;
  }

  setHover(index: number): void {
    this.hoveredIndex = index;
  }

  get isVisible(): boolean {
    return this.visible;
  }
  get inSubmenu(): boolean {
    return this._inSubmenu;
  }
  getItems(): readonly RadialMenuItem[] {
    return this.items;
  }
  getCenterItem(): RadialMenuItem | null {
    return this.centerItem;
  }

  /** Look up an item by hit-test index. */
  getItemAt(index: number): RadialMenuItem | null {
    if (index === CENTER_INDEX) return this.centerItem;
    if (index >= 0 && index < this.items.length) return this.items[index];
    return null;
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  hitTest(screenX: number, screenY: number): number {
    if (!this.visible) return -1;
    const dx = screenX - this.anchorX;
    const dy = screenY - this.anchorY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const active = this._inSubmenu ? RING_SUBMENU : RING_NORMAL;
    const centerR = this._inSubmenu ? RING_PARENT.innerR : RING_NORMAL.innerR;
    const ringInner = active.innerR;
    const ringOuter = active.outerR;

    // Center button
    if (dist < centerR) return this.centerItem ? CENTER_INDEX : -1;

    // Gap / parent ring zone (non-interactive)
    if (dist < ringInner) return -1;

    // Active ring
    if (dist > ringOuter || this.items.length === 0) return -1;

    let angle = Math.atan2(dx, -dy); // 0 = top, CW positive
    if (angle < 0) angle += Math.PI * 2;
    const n = this.items.length;
    const segArc = (Math.PI * 2) / n;
    // Rotate so first segment is centered at top (game: startAngle = -π/n)
    const shifted = (angle + Math.PI / n) % (Math.PI * 2);
    return Math.min(Math.floor(shifted / segArc), n - 1);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  draw(): void {
    if (!this.visible) return;
    if (this.items.length === 0 && !this.centerItem) return;

    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const vw = gl.drawingBufferWidth;
    const vh = gl.drawingBufferHeight;
    const ax = this.anchorX * dpr;
    const ay = this.anchorY * dpr;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);

    // Parent ring (dimmed, non-interactive) — drawn first so active ring overlays
    if (this._inSubmenu && this.savedItems.length > 0) {
      const p = RING_PARENT;
      this.drawRing(
        ax,
        ay,
        vw,
        vh,
        p,
        this.savedItems,
        -1,
        BACK_ITEM,
        this.hoveredIndex === CENTER_INDEX,
      );
    }

    // Active ring — expands when in submenu
    const active = this._inSubmenu ? RING_SUBMENU : RING_NORMAL;
    this.drawRing(
      ax,
      ay,
      vw,
      vh,
      active,
      this.items,
      this.hoveredIndex >= 0 ? this.hoveredIndex : -1,
      this._inSubmenu ? null : this.centerItem,
      !this._inSubmenu && this.hoveredIndex === CENTER_INDEX,
    );
  }

  /** Draw a single ring (arcs + icons) using a RingConfig. */
  private drawRing(
    ax: number,
    ay: number,
    vw: number,
    vh: number,
    cfg: RingConfig,
    items: readonly RadialMenuItem[],
    hoveredSeg: number,
    centerItem: RadialMenuItem | null,
    centerHovered: boolean,
  ): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    const n = items.length;
    const hasCenter = centerItem !== null;
    const outerR = cfg.outerR * dpr;
    const innerFrac = cfg.innerR / cfg.outerR;
    const dim = cfg.dim;
    const ih =
      typeof cfg.iconHalf === "function" ? cfg.iconHalf(n) : cfg.iconHalf;
    const iconHalf = ih * dpr;

    // --- Arcs ---
    gl.useProgram(this.arcProg);
    gl.uniform2f(this.arcU.anchor, ax, ay);
    gl.uniform2f(this.arcU.viewport, vw, vh);
    gl.uniform1f(this.arcU.outerR, outerR);
    gl.uniform1f(this.arcU.innerR, innerFrac);
    gl.uniform1i(this.arcU.segCount, n);
    gl.uniform1i(this.arcU.hoveredSeg, hoveredSeg);

    gl.uniform1i(this.arcU.hasCenterBtn, hasCenter ? 1 : 0);
    if (hasCenter) {
      const cc = centerItem.color;
      gl.uniform3f(
        this.arcU.centerColor,
        cc[0] * dim,
        cc[1] * dim,
        cc[2] * dim,
      );
      gl.uniform1i(this.arcU.centerHovered, centerHovered ? 1 : 0);
    }

    const colors = new Float32Array(MAX_SEGMENTS * 4);
    for (let i = 0; i < n; i++) {
      const c = items[i].color;
      colors[i * 4 + 0] = c[0] * dim;
      colors[i * 4 + 1] = c[1] * dim;
      colors[i * 4 + 2] = c[2] * dim;
      colors[i * 4 + 3] = items[i].enabled ? 1 : 0;
    }
    gl.uniform4fv(this.arcU.segColors, colors);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- Icons ---
    if (!this.emojiReady || (n === 0 && !hasCenter)) return;

    gl.useProgram(this.iconProg);
    gl.uniform2f(this.iconU.anchor, ax, ay);
    gl.uniform2f(this.iconU.viewport, vw, vh);
    gl.uniform1f(this.iconU.outerR, outerR);
    gl.uniform1f(this.iconU.innerR, innerFrac);
    gl.uniform1i(this.iconU.segCount, n);
    gl.uniform1f(this.iconU.iconHalf, iconHalf);

    const indices = new Float32Array(MAX_SEGMENTS);
    const opacities = new Float32Array(MAX_SEGMENTS);
    indices.fill(-1);
    opacities.fill(1);
    for (let i = 0; i < n; i++) {
      indices[i] = this.resolveEmoji(items[i].icon);
      opacities[i] = items[i].enabled ? 1.0 : 0.3;
    }
    gl.uniform1fv(this.iconU.emojiIndices, indices);
    gl.uniform1fv(this.iconU.segOpacity, opacities);

    const centerIdx = hasCenter ? this.resolveEmoji(centerItem.icon) : -1;
    gl.uniform1f(this.iconU.centerEmojiIdx, centerIdx);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.emojiTex!);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n + 1);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.arcProg);
    gl.deleteProgram(this.iconProg);
    gl.deleteVertexArray(this.vao);
    if (this.emojiTex) gl.deleteTexture(this.emojiTex);
  }
}
