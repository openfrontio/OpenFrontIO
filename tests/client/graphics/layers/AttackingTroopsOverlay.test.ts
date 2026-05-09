import { describe, expect, test } from "vitest";
import {
  alignClusterOrder,
  computeLabelScale,
} from "../../../../src/client/graphics/layers/AttackingTroopsOverlay";
import { Cell } from "../../../../src/core/game/Game";

describe("computeLabelScale", () => {
  // LABEL_FULL_SIZE_ZOOM = 4, LABEL_MIN_RENDERED_SIZE = 0.63,
  // LABEL_SIZE_MULTIPLIER = 1.0. Rendered size at zoom z:
  //   1.0 * (0.63 + 0.37 * min(1, z/4)).
  test("at the full-size threshold, rendered size is capped at the multiplier", () => {
    // zoom = 4 → rendered = 1.0 → scale = 1.0 / 4.
    expect(computeLabelScale(4)).toBeCloseTo(1.0 / 4);
  });

  test("above the threshold, rendered size stays capped (counter-scales zoom)", () => {
    // zoom = 8 → rendered still 1.0 → scale = 1.0 / 8.
    expect(computeLabelScale(8)).toBeCloseTo(1.0 / 8);
  });

  test("at zoom = 0+, rendered size approaches the floor", () => {
    // As zoom→0, t→0, rendered → 1.0 * 0.63 (the floor).
    // At zoom = 0.001, rendered ≈ floor, so scale ≈ floor / zoom = huge.
    const scale = computeLabelScale(0.001);
    const floorRendered = 1.0 * 0.63;
    // Within 1% of the floor-divided-by-zoom value.
    expect(scale).toBeGreaterThan((floorRendered / 0.001) * 0.99);
    expect(scale).toBeLessThan((floorRendered / 0.001) * 1.01);
  });

  test("interpolates linearly between floor and full-size threshold", () => {
    // zoom = 2 → t = 0.5 → rendered = 1.0 * (0.63 + 0.185) = 0.815.
    expect(computeLabelScale(2)).toBeCloseTo(0.815 / 2);
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
