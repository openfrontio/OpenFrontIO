/**
 * Runtime Arial bitmap-font atlas generator.
 *
 * The "classic" name font is Arial rendered to a coverage atlas (white glyphs
 * on transparent), as an alternative to the overpass-bold MSDF atlas. There's
 * no Arial asset to ship and no offline bmfont tooling, so the atlas is built
 * once at startup with canvas 2D: each glyph is rasterized, its tight bounding
 * box is found by scanning pixels, and the glyphs are shelf-packed.
 *
 * The atlas is SUPERSAMPLED: glyphs are rasterized RENDER_SCALE× larger than
 * the em metrics so edges stay finer/straighter when names are drawn large.
 * Metrics are still emitted in the MSDF em size (48) and baseline (36), so name
 * sizing, hit-testing, flag offsets and icon alignment are unchanged — the
 * extra atlas resolution is carried separately via the returned renderScale
 * (the name shader derives UVs from glyph size / atlas-pixels-per-em).
 */

import type { BMChar, ParsedAtlas } from "./Types";

// Em metrics (match the MSDF atlas so downstream sizing is identical).
const EM = 48;
const BASE = 36;
// Supersample factor: rasterize this much finer than the em metrics.
const RENDER_SCALE = 2;
const RENDER_PX = EM * RENDER_SCALE;

// Thin Arial. Arial ships no dedicated thin face, so browsers without one fall
// back to regular weight (still lighter than the MSDF bold).
const FONT = `100 ${RENDER_PX}px Arial, "Liberation Sans", sans-serif`;

// Measuring cell + pen, in render (supersampled) pixels.
const CELL = 160;
const PEN_X = 16;
const PEN_Y = 118;

const ATLAS_W = 2048; // render pixels
const PAD = 4; // transparent gutter between packed glyphs (> erosion radius)

// Arial has no face thinner than Regular, so thin the strokes slightly by
// eroding the rasterized coverage. Fractional: each pixel's alpha is reduced
// toward the minimum of its neighbourhood (render pixels), blended by strength.
const ERODE_PX = 1;
const ERODE_STRENGTH = 0.5; // 0 = none, 1 = hard min-filter

// Codepoint coverage: ASCII + Latin-1 + Latin Extended-A (matches CHAR_RANGE),
// skipping the C0/C1 control gaps. Covers player names and troop labels.
function* codepoints(): Generator<number> {
  for (let c = 32; c <= 383; c++) {
    if (c >= 127 && c <= 159) continue;
    yield c;
  }
}

interface Measured {
  code: number;
  ch: string;
  advance: number; // render px
  w: number; // render px
  h: number; // render px
  srcMinX: number; // tight bbox top-left in the measuring cell (render px)
  srcMinY: number;
}

export function generateArialBitmapAtlas(): {
  atlas: ParsedAtlas;
  canvas: HTMLCanvasElement;
  renderScale: number;
} {
  // --- measuring pass: rasterize each glyph, find its tight bbox ---
  const tmp = document.createElement("canvas");
  tmp.width = CELL;
  tmp.height = CELL;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  tctx.font = FONT;
  tctx.textBaseline = "alphabetic";
  tctx.textAlign = "left";
  tctx.fillStyle = "#fff";

  const measured: Measured[] = [];
  for (const code of codepoints()) {
    const ch = String.fromCodePoint(code);
    const advance = Math.ceil(tctx.measureText(ch).width);
    tctx.clearRect(0, 0, CELL, CELL);
    tctx.fillText(ch, PEN_X, PEN_Y);
    const data = tctx.getImageData(0, 0, CELL, CELL).data;

    let minX = CELL;
    let minY = CELL;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        if (data[(y * CELL + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) {
      // No ink (e.g. space) — advance only, zero-size glyph.
      measured.push({ code, ch, advance, w: 0, h: 0, srcMinX: 0, srcMinY: 0 });
      continue;
    }

    measured.push({
      code,
      ch,
      advance,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      srcMinX: minX,
      srcMinY: minY,
    });
  }

  // --- shelf packing into a fixed-width atlas (render pixels) ---
  const chars: BMChar[] = [];
  const placements: { m: Measured; ax: number; ay: number }[] = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const m of measured) {
    if (m.w === 0) {
      chars.push(toBMChar(m, 0, 0));
      continue;
    }
    if (x + m.w + PAD > ATLAS_W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    placements.push({ m, ax: x, ay: y });
    chars.push(toBMChar(m, x, y));
    x += m.w + PAD;
    if (m.h > rowH) rowH = m.h;
  }
  const ATLAS_H = y + rowH + PAD;

  // --- render pass: draw each glyph at its packed slot ---
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const actx = canvas.getContext("2d")!;
  actx.font = FONT;
  actx.textBaseline = "alphabetic";
  actx.textAlign = "left";
  actx.fillStyle = "#fff";
  for (const { m, ax, ay } of placements) {
    // Drawing at pen P put the bbox at (P + (srcMin - PEN)); solve for the pen
    // that lands the tight top-left at (ax, ay).
    const penX = ax - m.srcMinX + PEN_X;
    const penY = ay - m.srcMinY + PEN_Y;
    actx.fillText(m.ch, penX, penY);
  }

  erodeCoverage(actx, ATLAS_W, ATLAS_H);

  const atlas: ParsedAtlas = {
    fontSize: EM,
    base: BASE,
    scaleW: ATLAS_W,
    scaleH: ATLAS_H,
    distanceRange: 0,
    chars,
    kernings: [],
  };
  return { atlas, canvas, renderScale: RENDER_SCALE };
}

/**
 * Thin the rasterized glyphs by eroding the alpha (coverage) channel: each
 * pixel is pulled toward the minimum alpha in a (2·ERODE_PX+1)² window, blended
 * by ERODE_STRENGTH. Shrinks every stroke edge by ~ERODE_PX·ERODE_STRENGTH
 * render pixels.
 */
function erodeCoverage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  if (ERODE_PX <= 0 || ERODE_STRENGTH <= 0) return;
  const img = ctx.getImageData(0, 0, w, h);
  const a = img.data;
  const src = new Uint8ClampedArray(a.length);
  src.set(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      const cur = src[i];
      if (cur === 0) continue;
      let min = cur;
      for (let dy = -ERODE_PX; dy <= ERODE_PX && min > 0; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          min = 0;
          break;
        }
        for (let dx = -ERODE_PX; dx <= ERODE_PX; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) {
            min = 0;
            break;
          }
          const v = src[(yy * w + xx) * 4 + 3];
          if (v < min) min = v;
        }
      }
      a[i] = Math.round(cur + (min - cur) * ERODE_STRENGTH);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Build a glyph entry: atlas position in render px, metrics in em units. */
function toBMChar(m: Measured, ax: number, ay: number): BMChar {
  return {
    id: m.code,
    char: m.ch,
    width: m.w / RENDER_SCALE,
    height: m.h / RENDER_SCALE,
    xoffset: (m.srcMinX - PEN_X) / RENDER_SCALE,
    yoffset: BASE - (PEN_Y - m.srcMinY) / RENDER_SCALE,
    xadvance: m.advance / RENDER_SCALE,
    x: ax,
    y: ay,
    page: 0,
  };
}
