/**
 * Atlas data parsing — extracts font metrics, glyph lookup tables,
 * kerning data, and icon atlas index maps from static JSON assets.
 */

import emojiAtlasMeta from "resources/atlases/emoji-atlas-meta.json";
import { assetUrl } from "src/core/AssetUrls";
import type { BMChar, BMKerning, ParsedAtlas } from "./Types";
import { CHAR_RANGE } from "./Types";

// ---------------------------------------------------------------------------
// Atlas parsing
// ---------------------------------------------------------------------------

interface RawMsdfAtlas {
  info: { size: number };
  common: { base: number; scaleW: number; scaleH: number };
  distanceField?: { distanceRange: number };
  chars: BMChar[];
  kernings?: BMKerning[];
}

// Fetched at game-load time rather than statically imported — the JSON is
// large (~320 KB for overpass) and would otherwise sit in the main bundle.
const atlasData: Record<string, RawMsdfAtlas> = {};
const atlasPromises: Record<string, Promise<void>> = {};

function preload(file: string): Promise<void> {
  atlasPromises[file] ??= fetch(assetUrl(`atlases/${file}`))
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file}: ${response.status}`);
      }
      return response.json();
    })
    .then((json) => {
      atlasData[file] = json as RawMsdfAtlas;
    });
  return atlasPromises[file];
}

function parse(file: string): ParsedAtlas {
  const raw = atlasData[file];
  if (raw === undefined) {
    throw new Error(`Atlas ${file} not loaded; await its preload first`);
  }
  return {
    fontSize: raw.info.size,
    base: raw.common.base,
    scaleW: raw.common.scaleW,
    scaleH: raw.common.scaleH,
    distanceRange: raw.distanceField?.distanceRange ?? 4,
    chars: raw.chars,
    kernings: raw.kernings ?? [],
  };
}

/** Default MSDF font (overpass-bold) — names + troops + structure levels. */
export const preloadAtlasData = (): Promise<void> => preload("msdf-atlas.json");
export const parseAtlasData = (): ParsedAtlas => parse("msdf-atlas.json");

/** Classic name font: Arimo MSDF atlas (Arial-metric), same format as overpass. */
export const preloadArialAtlasData = (): Promise<void> =>
  preload("arial-atlas.json");
export const parseArialAtlasData = (): ParsedAtlas => parse("arial-atlas.json");

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

export function buildEmojiLookup(): Map<string, number> {
  const map = new Map<string, number>();
  const meta = emojiAtlasMeta as { emojis: Record<string, number> };
  for (const [ch, idx] of Object.entries(meta.emojis)) {
    map.set(ch, idx);
  }
  return map;
}
