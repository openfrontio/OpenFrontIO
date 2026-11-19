import {
  type FlickerRate,
  type FxLayer,
  FX_DEFAULTS,
} from "@openfront/shared/CardBackgroundAnimation";

// Effect layers for animated card backgrounds: the effect maths (pure, so
// every client draws the same thing) and the controller that mounts and
// moves the layers inside a <card-background>. Only transform and opacity
// ever change.

// ---- Effect maths. `t` is seconds since the animation started. ----

const TAU = 2 * Math.PI;

function fract(x: number): number {
  return x - Math.floor(x);
}

// Pulse: opacity eases min → max → min once per period, times strength.
export function pulseOpacity(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.period;
  const min = layer.min ?? FX_DEFAULTS.min;
  const max = layer.max ?? FX_DEFAULTS.max;
  const strength = layer.strength ?? FX_DEFAULTS.strength;
  return (min + (max - min) * (0.5 - 0.5 * Math.cos((TAU * t) / p))) * strength;
}

// Shimmer: the band is this fraction of the card wide.
export const SHIMMER_BAND_WIDTH = 0.18;

// Shimmer: the band's left edge as a fraction of the card's width, from 30%
// off the left edge (-0.3) to 30% off the right (1.3), once per period.
export function shimmerBandX(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.period;
  return -0.3 + 1.6 * fract(t / p);
}

// Drift: how far the doubled layer has moved left, in card widths, [0, 1).
export function driftOffset(t: number, layer: FxLayer): number {
  const p = layer.period ?? FX_DEFAULTS.driftPeriod;
  return fract(t / p);
}

// Flicker: seconds between bursts, per rate.
export const FLICKER_GAPS: Record<FlickerRate, readonly [number, number]> = {
  low: [4, 8],
  medium: [2, 4],
  high: [1, 2],
};
const FLASH_MIN = 0.06;
const FLASH_MAX = 0.12;
// Seconds between flashes inside one burst.
const IN_BURST_GAP_MIN = 0.08;
const IN_BURST_GAP_MAX = 0.2;
// Never more than this many flashes in any one-second window.
const MAX_FLASHES_PER_SECOND = 3;

export interface Flash {
  // Seconds.
  start: number;
  duration: number;
}

// A small seeded PRNG (FNV-1a hash of the seed into mulberry32), so a
// background flickers the same way on every client.
function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Flicker: bursts of 1–3 flashes, each on for 60–120 ms, with the rate's gap
// before each burst, over `seconds`. Seeded with the background's id. A
// flash that would make a fourth in any one-second window is dropped.
export function flickerSchedule(
  seed: string,
  rate: FlickerRate,
  seconds: number,
): Flash[] {
  const random = seededRandom(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const [gapLo, gapHi] = FLICKER_GAPS[rate];
  const flashes: Flash[] = [];
  let t = 0;
  for (;;) {
    t += between(gapLo, gapHi);
    const count = 1 + Math.floor(random() * 3);
    let end = t;
    for (let i = 0; i < count; i++) {
      if (i > 0) t += between(IN_BURST_GAP_MIN, IN_BURST_GAP_MAX);
      const duration = between(FLASH_MIN, FLASH_MAX);
      if (t + duration > seconds) return flashes;
      const third = flashes[flashes.length - MAX_FLASHES_PER_SECOND];
      const crowded =
        third !== undefined && t - (third.start + third.duration) < 1;
      if (!crowded) flashes.push({ start: t, duration });
      t += duration;
      end = t;
    }
    t = end;
  }
}

// Whether a flash is on at `t` (the schedule loops over `length` seconds).
export function flickerOn(t: number, flashes: Flash[], length: number): boolean {
  const local = t - Math.floor(t / length) * length;
  for (const f of flashes) {
    if (local < f.start) return false;
    if (local < f.start + f.duration) return true;
  }
  return false;
}
