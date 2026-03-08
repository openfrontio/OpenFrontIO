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

  test("throws for negative distance", () => {
    expect(() => estimateBoatEtaSeconds(-5, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for NaN distance", () => {
    expect(() => estimateBoatEtaSeconds(NaN, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for Infinity distance", () => {
    expect(() => estimateBoatEtaSeconds(Infinity, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for -Infinity distance", () => {
    expect(() => estimateBoatEtaSeconds(-Infinity, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for zero turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, 0)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for negative turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, -100)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for NaN turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, NaN)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for Infinity turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, Infinity)).toThrow(
      "Invalid turnIntervalMs",
    );
  });
});
