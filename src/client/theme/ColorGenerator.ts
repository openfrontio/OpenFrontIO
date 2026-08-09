import { Colord, colord, extend } from "colord";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);

/**
 * Bounds of the LCH volume colours are drawn from.
 *
 * Lightness stops short of both ends: near-black and near-white territory fills
 * read poorly against terrain and against the border colours derived from them.
 * Chroma stays above 25 so results don't collapse into washed-out greys.
 */
const LIGHTNESS_MIN = 35;
const LIGHTNESS_RANGE = 45;
const CHROMA_MIN = 25;
const CHROMA_RANGE = 85;

/**
 * Plastic number, the 3-dimensional analogue of the golden ratio. Successive
 * multiples of its reciprocal powers fill a volume evenly at every prefix
 * length — the R3 low-discrepancy sequence (Roberts, 2018).
 */
const PLASTIC = 1.2207440846057596;
const ALPHA_HUE = 1 / PLASTIC;
const ALPHA_LIGHTNESS = 1 / (PLASTIC * PLASTIC);
const ALPHA_CHROMA = 1 / (PLASTIC * PLASTIC * PLASTIC);

const fraction = (value: number): number => value - Math.floor(value);

/**
 * The `index`-th colour of a deterministic sweep through LCH space.
 *
 * The sequence is chosen so that any prefix is already well spread: colour 5 is
 * far from colours 0–4 without anyone having searched for it. A pool drawn from
 * it therefore covers the usable volume with far fewer entries than a regular
 * grid sweep of comparable quality, which is what keeps the registry's scan
 * cheap enough to run on every allocation.
 *
 * Deterministic and stateless: the same index always yields the same colour.
 */
export function sequenceColor(index: number): Colord {
  const h = fraction(0.5 + ALPHA_HUE * index) * 360;
  const l =
    LIGHTNESS_MIN + fraction(0.5 + ALPHA_LIGHTNESS * index) * LIGHTNESS_RANGE;
  const c = CHROMA_MIN + fraction(0.5 + ALPHA_CHROMA * index) * CHROMA_RANGE;
  return colord({ l, c, h });
}
