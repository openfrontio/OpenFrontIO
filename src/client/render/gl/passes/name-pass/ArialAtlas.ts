/**
 * Runtime Arial bitmap-font atlas generator.
 *
 * The "classic" name font is Arial rendered to a coverage atlas (white glyphs
 * on transparent), as an alternative to the overpass-bold MSDF atlas. There's
 * no Arial asset to ship and no offline bmfont tooling, so the atlas is built
 * once at startup with canvas 2D: each glyph is rasterized, its tight bounding
 * box is found by scanning pixels, and the glyphs are shelf-packed.
 *
 * Metrics are emitted with the SAME em size (48) and baseline (36) as the MSDF
 * atlas, so name sizing, hit-testing, flag offsets and icon alignment are all
 * unchanged — only the glyph shapes and advances differ. The returned shape is
 * a ParsedAtlas, so it flows through buildGlyphTables / buildGlyphMetricsTex /
 * layoutString exactly like the MSDF atlas.
 */

import type { BMChar, ParsedAtlas } from "./Types";

// Match the MSDF atlas em/base so all downstream sizing stays identical.
const EM = 48;
const BASE = 36;
// Thin Arial. Arial ships no dedicated thin face, so browsers without one fall
// back to regular weight (still much lighter than the MSDF bold).
const FONT = `100 ${EM}px Arial, "Liberation Sans", sans-serif`;

const ATLAS_W = 1024;
const PAD = 2; // transparent gutter between packed glyphs

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
  advance: number;
  w: number;
  h: number;
  xoffset: number;
  yoffset: number;
  // Where the tight bbox landed in the measuring canvas (to re-place it later).
  srcMinX: number;
  srcMinY: number;
}

export function generateArialBitmapAtlas(): {
  atlas: ParsedAtlas;
  canvas: HTMLCanvasElement;
} {
  // --- measuring pass: rasterize each glyph, find its tight bbox ---
  const CELL = 80; // > any 48px glyph incl. ascenders/descenders
  const PEN_X = 8;
  const PEN_Y = 56; // baseline inside the measuring cell
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
      measured.push({
        code,
        ch,
        advance,
        w: 0,
        h: 0,
        xoffset: 0,
        yoffset: 0,
        srcMinX: 0,
        srcMinY: 0,
      });
      continue;
    }

    measured.push({
      code,
      ch,
      advance,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      xoffset: minX - PEN_X, // glyph left relative to the pen
      yoffset: BASE - (PEN_Y - minY), // glyph top relative to the line top
      srcMinX: minX,
      srcMinY: minY,
    });
  }

  // --- shelf packing into a fixed-width atlas ---
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

  const atlas: ParsedAtlas = {
    fontSize: EM,
    base: BASE,
    scaleW: ATLAS_W,
    scaleH: ATLAS_H,
    distanceRange: 0,
    chars,
    kernings: [],
  };
  return { atlas, canvas };
}

function toBMChar(m: Measured, ax: number, ay: number): BMChar {
  return {
    id: m.code,
    char: m.ch,
    width: m.w,
    height: m.h,
    xoffset: m.xoffset,
    yoffset: m.yoffset,
    xadvance: m.advance,
    x: ax,
    y: ay,
    page: 0,
  };
}
