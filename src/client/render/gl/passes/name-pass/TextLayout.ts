/**
 * Pure CPU text shaping — cursor position computation and number formatting.
 * No WebGL dependency.
 */

import type { GlyphTables } from "./AtlasData";
import { CHAR_RANGE, MAX_CHARS } from "./Types";

export interface LayoutResult {
  charCodes: Uint8Array; // char code per slot (MAX_CHARS, zero-padded)
  cursors: Float32Array; // centered cursor X per slot (MAX_CHARS)
  halfWidth: number; // visual half-width in font units
}

/**
 * Lay out a string: encode char codes, compute advance-based cursor X
 * positions, then center on visual bounds.
 *
 * Writes into caller-provided buffers to avoid allocation.
 */
export function layoutString(
  text: string,
  glyph: GlyphTables,
  kernTable: Int8Array,
  charCodes: Uint8Array,
  cursors: Float32Array,
): number {
  charCodes.fill(0);
  cursors.fill(0);
  const len = Math.min(text.length, MAX_CHARS);

  for (let i = 0; i < len; i++) {
    charCodes[i] = text.charCodeAt(i);
  }

  // Advance-based cursor positions
  let cumulative = 0;
  let prevCode = 0;
  for (let i = 0; i < len; i++) {
    const code = charCodes[i];
    cursors[i] = cumulative;
    let adv = glyph.advance[code];
    if (i > 0) {
      adv += kernTable[prevCode * CHAR_RANGE + code];
    }
    cumulative += adv;
    prevCode = code;
  }

  // Center on visual bounds (not advance bounds)
  const firstCode = charCodes[0];
  const lastCode = charCodes[len - 1];
  const visualLeft = cursors[0] + glyph.xOffset[firstCode];
  const visualRight =
    cursors[len - 1] + glyph.xOffset[lastCode] + glyph.visW[lastCode];
  const visualCenter = (visualLeft + visualRight) * 0.5;
  for (let i = 0; i < len; i++) {
    cursors[i] -= visualCenter;
  }

  return (visualRight - visualLeft) * 0.5;
}
