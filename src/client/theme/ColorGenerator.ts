import { Colord, colord, extend } from "colord";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);

/**
 * Bounds of the LCH sweep used when the curated palettes cannot supply a colour
 * that clears a theme's distinctness floor.
 *
 * Lightness stops short of both ends: near-black and near-white territory fills
 * read poorly against terrain and against the border colours derived from them.
 * Chroma stays above 25 so candidates don't collapse into washed-out greys.
 */
const LIGHTNESS_MIN = 35;
const LIGHTNESS_MAX = 80;
const LIGHTNESS_STEP = 5;
const CHROMA_MIN = 25;
const CHROMA_MAX = 110;
const CHROMA_STEP = 8.5;
const HUE_STEP = 6;

/**
 * Candidate colours swept from LCH space, deduplicated by hex.
 *
 * Deduplication is load-bearing: LCH coordinates outside the sRGB gamut clamp
 * on conversion and collapse onto the gamut surface, so a raw sweep contains
 * repeats. Clamped colours are still valid, highly saturated candidates — they
 * are kept, just not duplicated. Clamping also lifts a few results past the
 * nominal lightness ceiling, to roughly 87.
 *
 * The constants above yield 6125 candidates from 6600 sweep points.
 *
 * Deterministic: no RNG, and the iteration order is fixed.
 */
export function generateCandidateColors(): Colord[] {
  const seen = new Set<string>();
  const candidates: Colord[] = [];
  for (let l = LIGHTNESS_MIN; l <= LIGHTNESS_MAX; l += LIGHTNESS_STEP) {
    for (let c = CHROMA_MIN; c <= CHROMA_MAX; c += CHROMA_STEP) {
      for (let h = 0; h < 360; h += HUE_STEP) {
        const color = colord({ l, c, h });
        const hex = color.toHex();
        if (seen.has(hex)) {
          continue;
        }
        seen.add(hex);
        candidates.push(color);
      }
    }
  }
  return candidates;
}
