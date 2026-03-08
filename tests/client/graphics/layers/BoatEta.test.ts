import { describe, expect, test } from "vitest";
import { estimateBoatEtaSeconds } from "../../../../src/client/graphics/layers/AttacksDisplay";

describe("estimateBoatEtaSeconds", () => {
  test("returns correct seconds for standard distance", () => {
    expect(estimateBoatEtaSeconds(100, 100)).toBe(10);
  });

  test("ceils fractional results", () => {
    expect(estimateBoatEtaSeconds(15, 100)).toBe(2);
  });

  test("returns 0 for zero distance", () => {
    expect(estimateBoatEtaSeconds(0, 100)).toBe(0);
  });

  test("returns correct seconds for large distance", () => {
    expect(estimateBoatEtaSeconds(1000, 100)).toBe(100);
  });

  test("handles different tick intervals", () => {
    expect(estimateBoatEtaSeconds(100, 50)).toBe(5);
  });

  test("returns null for negative distance", () => {
    expect(estimateBoatEtaSeconds(-5, 100)).toBeNull();
  });

  test("returns null for NaN distance", () => {
    expect(estimateBoatEtaSeconds(NaN, 100)).toBeNull();
  });

  test("returns null for Infinity distance", () => {
    expect(estimateBoatEtaSeconds(Infinity, 100)).toBeNull();
  });

  test("returns null for zero turnIntervalMs", () => {
    expect(estimateBoatEtaSeconds(100, 0)).toBeNull();
  });

  test("returns null for negative turnIntervalMs", () => {
    expect(estimateBoatEtaSeconds(100, -100)).toBeNull();
  });

  test("returns null for NaN turnIntervalMs", () => {
    expect(estimateBoatEtaSeconds(100, NaN)).toBeNull();
  });
});
