import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";

describe("GameMap.neighbors8", () => {
  // A 3x3 map:
  // 0 1 2
  // 3 4 5
  // 6 7 8
  const map = new GameMapImpl(3, 3, new Uint8Array(3 * 3), 0);

  it("returns all 8 neighbors for a center tile in dx-major order", () => {
    const out = new Array(8);
    const count = map.neighbors8(4, out);
    expect(count).toBe(8);
    expect(out.slice(0, count)).toEqual([0, 3, 6, 1, 7, 2, 5, 8]);
  });

  it("returns 3 neighbors for a corner tile in dx-major order", () => {
    const out = new Array(8);

    // top-left corner
    let count = map.neighbors8(0, out);
    expect(count).toBe(3);
    expect(out.slice(0, count)).toEqual([3, 1, 4]);

    // bottom-right corner
    count = map.neighbors8(8, out);
    expect(count).toBe(3);
    expect(out.slice(0, count)).toEqual([4, 7, 5]);
  });

  it("returns 5 neighbors for an edge tile in dx-major order", () => {
    const out = new Array(8);

    // left edge
    let count = map.neighbors8(3, out);
    expect(count).toBe(5);
    expect(out.slice(0, count)).toEqual([0, 6, 1, 4, 7]);

    // top edge
    count = map.neighbors8(1, out);
    expect(count).toBe(5);
    expect(out.slice(0, count)).toEqual([0, 3, 4, 2, 5]);
  });
});
