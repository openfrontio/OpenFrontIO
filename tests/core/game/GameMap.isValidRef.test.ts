import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";

describe("GameMap.isValidRef", () => {
  const map = new GameMapImpl(10, 8, new Uint8Array(10 * 8), 0);

  it("accepts integer refs within range", () => {
    expect(map.isValidRef(0)).toBe(true);
    expect(map.isValidRef(1)).toBe(true);
    expect(map.isValidRef(10 * 8 - 1)).toBe(true);
  });

  it("rejects refs outside the map", () => {
    expect(map.isValidRef(-1)).toBe(false);
    expect(map.isValidRef(10 * 8)).toBe(false);
    expect(map.isValidRef(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("rejects non-integer refs even when in range", () => {
    // A fractional ref passes a pure range check but corrupts anything that
    // indexes typed arrays or iterates from it — a single malicious intent
    // could freeze the simulation on every client.
    expect(map.isValidRef(1.5)).toBe(false);
    expect(map.isValidRef(0.0000001)).toBe(false);
    expect(map.isValidRef(79.999)).toBe(false);
  });

  it("rejects NaN and infinities", () => {
    expect(map.isValidRef(NaN)).toBe(false);
    expect(map.isValidRef(Infinity)).toBe(false);
    expect(map.isValidRef(-Infinity)).toBe(false);
  });
});
