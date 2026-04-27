import { describe, expect, test } from "vitest";
import { computeLabelScale } from "../../../../src/client/graphics/layers/AttackingTroopsOverlay";

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
