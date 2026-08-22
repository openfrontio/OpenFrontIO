import { Colord, colord, extend } from "colord";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);

/**
 * The region of LCH space a palette occupies.
 *
 * Each player-type palette has its own character, and that character carries
 * meaning: human colours are bright and saturated, nation colours noticeably
 * more restrained, bot colours nearly grey. A player reads those differences
 * without being told. Synthesised colours therefore have to be drawn from the
 * same region as the palette they extend, or a nation starts looking like a
 * player.
 */
export interface ColorEnvelope {
  lightnessMin: number;
  lightnessMax: number;
  chromaMin: number;
  chromaMax: number;
}

/**
 * Absolute bounds applied on top of any palette's own range. Near-black and
 * near-white fills read poorly against terrain and against the borders derived
 * from them, whatever the palette does.
 */
const LIGHTNESS_FLOOR = 30;
const LIGHTNESS_CEILING = 88;

/** Ignore this proportion at each end, so one outlier cannot stretch a range. */
const TRIM = 0.05;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

function trimmedRange(values: number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * TRIM);
  return [sorted[drop], sorted[Math.max(drop, sorted.length - 1 - drop)]];
}

/**
 * The LCH region a palette occupies, used to keep synthesised colours in
 * character with it. Falls back to a broad range for palettes too small to
 * describe a region.
 */
export function paletteEnvelope(colors: Colord[]): ColorEnvelope {
  if (colors.length < 4) {
    return {
      lightnessMin: 35,
      lightnessMax: 80,
      chromaMin: 25,
      chromaMax: 110,
    };
  }
  const lch = colors.map((color) => color.toLch());
  const [lLow, lHigh] = trimmedRange(lch.map((x) => x.l));
  const [cLow, cHigh] = trimmedRange(lch.map((x) => x.c));
  return {
    lightnessMin: clamp(lLow, LIGHTNESS_FLOOR, LIGHTNESS_CEILING),
    lightnessMax: clamp(lHigh, LIGHTNESS_FLOOR, LIGHTNESS_CEILING),
    // Never collapse to a single value: a palette of near-identical chroma
    // still needs somewhere to put a new colour.
    chromaMin: Math.max(0, cLow),
    chromaMax: Math.max(cHigh, cLow + 12),
  };
}

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
 * The `index`-th colour of a deterministic sweep through `envelope`.
 *
 * The sequence is chosen so that any prefix is already well spread: colour 5 is
 * far from colours 0–4 without anyone having searched for it. A pool drawn from
 * it therefore covers the region with far fewer entries than a regular grid of
 * comparable quality, which is what keeps the registry's scan cheap enough to
 * run on every allocation.
 *
 * Deterministic and stateless: the same index and envelope always yield the
 * same colour.
 */
export function sequenceColor(index: number, envelope: ColorEnvelope): Colord {
  const lightnessRange = envelope.lightnessMax - envelope.lightnessMin;
  const chromaRange = envelope.chromaMax - envelope.chromaMin;
  const h = fraction(0.5 + ALPHA_HUE * index) * 360;
  const l =
    envelope.lightnessMin +
    fraction(0.5 + ALPHA_LIGHTNESS * index) * lightnessRange;
  const c =
    envelope.chromaMin + fraction(0.5 + ALPHA_CHROMA * index) * chromaRange;
  return colord({ l, c, h });
}
