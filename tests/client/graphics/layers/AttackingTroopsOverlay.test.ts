import { describe, expect, test } from "vitest";
import {
  alignClusterOrder,
  computeBarStrength,
  computeLabelScale,
} from "../../../../src/client/graphics/layers/AttackingTroopsOverlay";
import { Cell } from "../../../../src/core/game/Game";

describe("computeLabelScale", () => {
  test("counter-scales the zoom when above the full-size threshold", () => {
    // zoom = 2 → label rendered at 1/2 to stay at full screen size.
    expect(computeLabelScale(2)).toBeCloseTo(0.5);
  });

  test("counter-scales exactly at the full-size threshold", () => {
    // zoom = 1.5 → label rendered at 1/1.5 ≈ 0.6667.
    expect(computeLabelScale(1.5)).toBeCloseTo(1 / 1.5);
  });

  test("rides the world transform between the floor and the threshold", () => {
    // Below the threshold, netScale = zoom / 1.5, so the factor is constant 1/1.5.
    expect(computeLabelScale(1)).toBeCloseTo(1 / 1.5);
    expect(computeLabelScale(0.9)).toBeCloseTo(1 / 1.5);
  });

  test("floor engages exactly at zoom = 0.75 (LABEL_MIN_SCREEN_SCALE * LABEL_FULL_SIZE_ZOOM)", () => {
    expect(computeLabelScale(0.75)).toBeCloseTo(1 / 1.5);
  });

  test("grows in screen space when zoomed out past the floor", () => {
    // zoom = 0.5 → netScale clamped to 0.5, factor = 0.5 / 0.5 = 1.
    expect(computeLabelScale(0.5)).toBeCloseTo(1);
    // zoom = 0.25 → factor = 0.5 / 0.25 = 2.
    expect(computeLabelScale(0.25)).toBeCloseTo(2);
  });
});

describe("computeBarStrength", () => {
  test("equal troops sit at the midpoint", () => {
    // 1000 vs 1000 → ratio 1, divided by full-height ratio of 2 → 0.5.
    expect(computeBarStrength(1000, 1000)).toBeCloseTo(0.5);
  });

  test("attacker with no troops yields a zero-height bar", () => {
    expect(computeBarStrength(0, 1000)).toBe(0);
  });

  test("scales linearly between zero and the full-height threshold", () => {
    // 500 vs 1000 → ratio 0.5 → 0.25.
    expect(computeBarStrength(500, 1000)).toBeCloseTo(0.25);
    // 1500 vs 1000 → ratio 1.5 → 0.75.
    expect(computeBarStrength(1500, 1000)).toBeCloseTo(0.75);
  });

  test("clamps at full height when attacker has 2× the opposition", () => {
    expect(computeBarStrength(2000, 1000)).toBeCloseTo(1);
    expect(computeBarStrength(10_000, 1000)).toBeCloseTo(1);
  });

  test("returns full height when the opposing side has no troops", () => {
    // Avoids division-by-zero: an undefended target is maximum strength.
    expect(computeBarStrength(500, 0)).toBe(1);
    expect(computeBarStrength(0, 0)).toBe(1);
  });
});

describe("alignClusterOrder", () => {
  const c = (x: number, y: number) => new Cell(x, y);

  test("preserves order when direct mapping is closer", () => {
    const next = [c(10, 10), c(100, 100)];
    const prev = [c(12, 11), c(98, 102)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(10);
    expect(next[1].x).toBe(100);
  });

  test("swaps when the worker reordered same-size clusters", () => {
    // prev[0] is near (10,10), prev[1] is near (100,100); the worker returned
    // them in the opposite order. Expect swap so each label sticks to its front.
    const next = [c(101, 99), c(11, 12)];
    const prev = [c(10, 10), c(100, 100)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(11);
    expect(next[1].x).toBe(101);
  });

  test("does not swap on a tie (strict less-than)", () => {
    const next = [c(0, 0), c(10, 0)];
    const prev = [c(5, 0), c(5, 0)];
    alignClusterOrder(next, prev);
    expect(next[0].x).toBe(0);
    expect(next[1].x).toBe(10);
  });

  test("no-op when fewer than two new positions", () => {
    const single = [c(99, 99)];
    alignClusterOrder(single, [c(0, 0), c(1000, 1000)]);
    expect(single[0].x).toBe(99);

    const empty: Cell[] = [];
    alignClusterOrder(empty, [c(0, 0), c(1000, 1000)]);
    expect(empty.length).toBe(0);
  });

  test("no-op when either previous slot is null (initial render)", () => {
    const next = [c(100, 100), c(0, 0)];
    alignClusterOrder(next, [null, c(0, 0)]);
    expect(next[0].x).toBe(100);
    expect(next[1].x).toBe(0);

    alignClusterOrder(next, [c(0, 0), null]);
    expect(next[0].x).toBe(100);
    expect(next[1].x).toBe(0);

    alignClusterOrder(next, [null, null]);
    expect(next[0].x).toBe(100);
    expect(next[1].x).toBe(0);
  });

  test("no-op when more than two new positions (assumed cap)", () => {
    const next = [c(100, 0), c(0, 0), c(50, 0)];
    alignClusterOrder(next, [c(0, 0), c(100, 0)]);
    expect(next.map((p) => p.x)).toEqual([100, 0, 50]);
  });
});
