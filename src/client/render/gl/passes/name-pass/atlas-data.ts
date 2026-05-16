/**
 * Atlas data parsing — extracts font metrics, glyph lookup tables,
 * kerning data, and icon atlas index maps from static JSON assets.
 */

import emojiAtlasMeta from "../../assets/emoji-atlas-meta.json";
import flagAtlasMeta from "../../assets/flag-atlas-meta.json";
import atlasData from "../../assets/msdf-atlas.json";
import type { BMChar, BMKerning, ParsedAtlas } from "./types";
import { CHAR_RANGE } from "./types";

// ---------------------------------------------------------------------------
// Atlas parsing
// ---------------------------------------------------------------------------

export function parseAtlasData(): ParsedAtlas {
  return {
    fontSize: atlasData.info.size,
    base: atlasData.common.base,
    scaleW: atlasData.common.scaleW,
    scaleH: atlasData.common.scaleH,
    distanceRange: (atlasData as any).distanceField?.distanceRange ?? 4,
    chars: atlasData.chars as BMChar[],
    kernings: (atlasData.kernings ?? []) as BMKerning[],
  };
}

// ---------------------------------------------------------------------------
// CPU-side glyph lookup tables
// ---------------------------------------------------------------------------

export interface GlyphTables {
  advance: Float32Array; // [CHAR_RANGE] — xadvance per char ID
  xOffset: Float32Array; // [CHAR_RANGE] — xoffset (left bearing) per char ID
  visW: Float32Array; // [CHAR_RANGE] — visible glyph width per char ID
}

export function buildGlyphTables(chars: BMChar[]): GlyphTables {
  const advance = new Float32Array(CHAR_RANGE);
  const xOffset = new Float32Array(CHAR_RANGE);
  const visW = new Float32Array(CHAR_RANGE);
  for (const ch of chars) {
    if (ch.id < CHAR_RANGE) {
      advance[ch.id] = ch.xadvance;
      xOffset[ch.id] = ch.xoffset;
      visW[ch.id] = ch.width;
    }
  }
  return { advance, xOffset, visW };
}

// ---------------------------------------------------------------------------
// Kerning table (amounts are small integers: typically -7 to +4)
// ---------------------------------------------------------------------------

export function buildKernTable(kernings: BMKerning[]): Int8Array {
  const table = new Int8Array(CHAR_RANGE * CHAR_RANGE);
  for (const k of kernings) {
    if (k.first < CHAR_RANGE && k.second < CHAR_RANGE) {
      table[k.first * CHAR_RANGE + k.second] = k.amount;
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// Icon atlas lookups
// ---------------------------------------------------------------------------

export function buildFlagLookup(): Map<string, number> {
  const map = new Map<string, number>();
  const meta = flagAtlasMeta as { flags: Record<string, number> };
  for (const [code, idx] of Object.entries(meta.flags)) {
    map.set(code, idx);
  }
  return map;
}

export function buildEmojiLookup(): Map<string, number> {
  const map = new Map<string, number>();
  const meta = emojiAtlasMeta as { emojis: Record<string, number> };
  for (const [ch, idx] of Object.entries(meta.emojis)) {
    map.set(ch, idx);
  }
  return map;
}
