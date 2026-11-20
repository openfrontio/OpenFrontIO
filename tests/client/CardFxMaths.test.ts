import type { FxLayer } from "@openfront/shared/CardBackgroundAnimation";
import { describe, expect, it } from "vitest";
import {
  driftOffset,
  FLICKER_GAPS,
  flickerSchedule,
  pulseOpacity,
  SHIMMER_BAND_WIDTH,
  SHIMMER_MAX_ANGLE,
  shimmerBand,
  shimmerBandX,
} from "../../src/client/components/card/CardFx";

const pulse = (extra: Partial<FxLayer> = {}): FxLayer => ({
  src: "/a.png",
  effect: "pulse",
  ...extra,
});

describe("pulseOpacity", () => {
  it("runs from min to max and back once per period, times strength", () => {
    const layer = pulse({ period: 2, min: 0.2, max: 0.8, strength: 0.5 });
    expect(pulseOpacity(0, layer)).toBeCloseTo(0.2 * 0.5);
    expect(pulseOpacity(1, layer)).toBeCloseTo(0.8 * 0.5);
    expect(pulseOpacity(2, layer)).toBeCloseTo(0.2 * 0.5);
    expect(pulseOpacity(0.5, layer)).toBeCloseTo(0.5 * 0.5);
  });

  it("uses the defaults: period 2.5, min 0.3, max 1, strength 1", () => {
    expect(pulseOpacity(0, pulse())).toBeCloseTo(0.3);
    expect(pulseOpacity(1.25, pulse())).toBeCloseTo(1);
  });
});

describe("shimmerBandX", () => {
  const layer: FxLayer = { src: "/a.png", effect: "shimmer", period: 4 };

  it("crosses from 30% off the left to 30% off the right once per period", () => {
    expect(shimmerBandX(0, layer)).toBeCloseTo(-0.3);
    expect(shimmerBandX(2, layer)).toBeCloseTo(0.5);
    expect(shimmerBandX(3.999, layer)).toBeCloseTo(1.3, 2);
    expect(shimmerBandX(4, layer)).toBeCloseTo(-0.3);
  });

  it("is 18% of the card wide", () => {
    expect(SHIMMER_BAND_WIDTH).toBe(0.18);
  });
});

describe("shimmerBand (rotated)", () => {
  // A 2.6:1 card, band at 45°: the steep, narrow case.
  const W = 2.6;
  const H = 1;
  const layer: FxLayer = {
    src: "/a.png",
    effect: "shimmer",
    period: 4,
    angle: 45,
  };
  const at = (t: number) => {
    const b = shimmerBand(t, layer);
    return { ...b, centre: b.centreW * W + b.centreH * H };
  };
  // How far the rotated band reaches sideways from its centre line within
  // the card's height.
  const reach = (angleDeg: number) => {
    const a = (Math.abs(angleDeg) * Math.PI) / 180;
    return (SHIMMER_BAND_WIDTH * W) / (2 * Math.cos(a)) + (H / 2) * Math.tan(a);
  };

  it("starts wholly off the left and ends wholly off the right", () => {
    const start = at(0);
    expect(start.centre + reach(45)).toBeLessThanOrEqual(0);
    const end = at(3.9999);
    expect(end.centre - reach(45)).toBeGreaterThanOrEqual(W - 1e-3);
  });

  it("is long enough to span the card's diagonal", () => {
    const { lengthW, lengthH } = at(1);
    expect(lengthW * W + lengthH * H).toBeGreaterThanOrEqual(Math.hypot(W, H));
  });

  // The band is centred on the card's middle row and rotated about its own
  // centre, so an end's nearest corner is (L/2)·cos a − (b/2)·sin a from that
  // row. Above H/2 the end is off the card wherever the band is across.
  it.each([0, 20, 45, 60, 80, 90, -80])(
    "keeps both ends off the card for the whole sweep at %i°",
    (angle) => {
      for (const aspect of [2.6, 2.9, 4, 6.3, 7]) {
        const b = shimmerBand(0, { ...layer, angle });
        const a = (Math.abs(b.angle) * Math.PI) / 180;
        const length = b.lengthW * aspect + b.lengthH * 1;
        const band = SHIMMER_BAND_WIDTH * aspect;
        const nearestCorner =
          (length / 2) * Math.cos(a) - (band / 2) * Math.sin(a);
        expect(nearestCorner, `aspect ${aspect}`).toBeGreaterThanOrEqual(0.5);
      }
    },
  );

  // centreH is a sideways offset measured in card heights (the H·tan a part
  // of the tilted band's reach), not a vertical move. Read as vertical, the
  // band starts the sweep already across the card.
  it("centreH is horizontal: read as a vertical move, the band starts on the card", () => {
    const b = shimmerBand(0, layer);
    const a = (45 * Math.PI) / 180;
    const half = (SHIMMER_BAND_WIDTH * W) / (2 * Math.cos(a));
    // Rightmost point of the band within the card's rows (y from -H/2 to
    // H/2 around the middle row), for a band centred at (x, y).
    const rightmost = (x: number, y: number) =>
      Math.max(...[-H / 2, H / 2].map((row) => x + (row - y) * Math.tan(a))) +
      half;
    // As drawn: both terms move the band sideways; it starts off the card.
    expect(rightmost(b.centreW * W + b.centreH * H, 0)).toBeLessThanOrEqual(0);
    // As a vertical move instead, part of the band is already on the card.
    expect(rightmost(b.centreW * W, b.centreH * H)).toBeGreaterThan(0);
  });

  it("draws angles past the limit at the limit", () => {
    expect(shimmerBand(0, { ...layer, angle: 90 }).angle).toBe(
      SHIMMER_MAX_ANGLE,
    );
    expect(shimmerBand(0, { ...layer, angle: -90 }).angle).toBe(
      -SHIMMER_MAX_ANGLE,
    );
  });

  it("matches the spec's travel when upright", () => {
    const upright = { ...layer, angle: 0 };
    const b = shimmerBand(0, upright);
    // Left edge 30% off the left.
    expect(b.centreW - SHIMMER_BAND_WIDTH / 2).toBeCloseTo(-0.3);
    expect(b.centreH).toBeCloseTo(0);
  });
});

describe("driftOffset", () => {
  const layer: FxLayer = { src: "/a.png", effect: "drift", period: 40 };

  it("moves one card width per period and loops", () => {
    expect(driftOffset(0, layer)).toBe(0);
    expect(driftOffset(10, layer)).toBeCloseTo(0.25);
    expect(driftOffset(40, layer)).toBeCloseTo(driftOffset(0, layer));
    expect(driftOffset(50, layer)).toBeCloseTo(0.25);
    for (let t = 0; t < 200; t += 0.7) {
      const x = driftOffset(t, layer);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("defaults to a 60 s period", () => {
    expect(driftOffset(30, { src: "/a.png", effect: "drift" })).toBeCloseTo(
      0.5,
    );
  });
});

describe("flickerSchedule", () => {
  it("is the same for the same seed and differs for another", () => {
    const a = flickerSchedule("bg_storm_front", "medium", 120);
    expect(flickerSchedule("bg_storm_front", "medium", 120)).toEqual(a);
    expect(flickerSchedule("bg_other", "medium", 120)).not.toEqual(a);
  });

  it.each(["low", "medium", "high"] as const)(
    "at %s: flashes of 60–120 ms, at most 3 in any one-second window",
    (rate) => {
      const flashes = flickerSchedule("bg_storm_front", rate, 600);
      expect(flashes.length).toBeGreaterThan(10);
      for (const f of flashes) {
        expect(f.duration).toBeGreaterThanOrEqual(0.06);
        expect(f.duration).toBeLessThanOrEqual(0.12);
        expect(f.start + f.duration).toBeLessThanOrEqual(600);
      }
      for (let i = 1; i < flashes.length; i++) {
        // In order and never overlapping.
        expect(flashes[i].start).toBeGreaterThanOrEqual(
          flashes[i - 1].start + flashes[i - 1].duration,
        );
      }
      // Four flashes fit in one window only if the fourth starts less than
      // a second after the first ends.
      for (let i = 0; i + 3 < flashes.length; i++) {
        expect(
          flashes[i + 3].start - (flashes[i].start + flashes[i].duration),
        ).toBeGreaterThanOrEqual(1);
      }
      // Sliding-window check too, in 10 ms steps.
      for (let w = 0; w < 600; w += 0.01) {
        const inWindow = flashes.filter(
          (f) => f.start < w + 1 && f.start + f.duration > w,
        ).length;
        expect(inWindow).toBeLessThanOrEqual(3);
      }
    },
  );

  it.each(["low", "medium", "high"] as const)(
    "at %s: bursts of 1–3 flashes, with the rate's gap between bursts",
    (rate) => {
      const [lo, hi] = FLICKER_GAPS[rate];
      const flashes = flickerSchedule("bg_seed", rate, 600);
      let burst = 1;
      const bursts: number[] = [];
      for (let i = 1; i < flashes.length; i++) {
        const gap =
          flashes[i].start - (flashes[i - 1].start + flashes[i - 1].duration);
        if (gap < 0.5) {
          burst++;
        } else {
          expect(gap).toBeGreaterThanOrEqual(lo);
          expect(gap).toBeLessThanOrEqual(hi);
          bursts.push(burst);
          burst = 1;
        }
      }
      bursts.push(burst);
      expect(Math.min(...bursts)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...bursts)).toBeLessThanOrEqual(3);
      // The first burst waits a gap too.
      expect(flashes[0].start).toBeGreaterThanOrEqual(lo);
    },
  );

  it("uses the spec's gaps", () => {
    expect(FLICKER_GAPS).toEqual({
      low: [4, 8],
      medium: [2, 4],
      high: [1, 2],
    });
  });
});
