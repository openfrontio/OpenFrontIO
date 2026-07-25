import {
  downsample4x,
  nearestFillGlobal,
  nearestFillLand,
} from "../scripts/regions/raster-utils";
import { computeRegionBorderMask } from "../src/core/game/RegionMap";

describe("nearestFillLand", () => {
  test("fills unassigned ownable tiles from the nearest assigned tile", () => {
    // 5x1 strip, ids assigned at both ends.
    const ids = new Uint16Array([1, 0, 0, 0, 2]);
    const ownable = new Uint8Array([1, 1, 1, 1, 1]);
    nearestFillLand(ids, ownable, 5, 1);
    expect([...ids]).toEqual([1, 1, 1, 2, 2]);
  });

  test("deterministic tie-break: equidistant tile goes to the earlier-enqueued source", () => {
    // 3x1 strip: sources at 0 (id 1) and 2 (id 2); middle tile is equidistant.
    // BFS seeds enqueue in ascending tile order, so id 1 wins.
    const ids = new Uint16Array([1, 0, 2]);
    const ownable = new Uint8Array([1, 1, 1]);
    nearestFillLand(ids, ownable, 3, 1);
    expect(ids[1]).toBe(1);
  });

  test("does not cross water and leaves isolated islands at 0", () => {
    // land(1) water land(0)
    const ids = new Uint16Array([1, 0, 0]);
    const ownable = new Uint8Array([1, 0, 1]);
    nearestFillLand(ids, ownable, 3, 1);
    expect(ids[1]).toBe(0); // water untouched
    expect(ids[2]).toBe(0); // island unreached
  });

  test("does not touch non-ownable tiles", () => {
    const ids = new Uint16Array([1, 0, 0, 0]);
    const ownable = new Uint8Array([1, 1, 0, 1]);
    nearestFillLand(ids, ownable, 4, 1);
    expect([...ids]).toEqual([1, 1, 0, 0]);
  });
});

describe("nearestFillGlobal", () => {
  test("assigns isolated islands across water", () => {
    const ids = new Uint16Array([1, 0, 0, 0, 0]);
    const ownable = new Uint8Array([1, 0, 0, 0, 1]);
    nearestFillGlobal(ids, ownable, 5, 1);
    expect(ids[4]).toBe(1);
    // water tiles stay unassigned in the output raster
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(0);
    expect(ids[3]).toBe(0);
  });

  test("island goes to the nearest region across water", () => {
    const ids = new Uint16Array([1, 0, 0, 0, 0, 0, 2]);
    const ownable = new Uint8Array([1, 0, 0, 0, 1, 0, 1]);
    nearestFillGlobal(ids, ownable, 7, 1);
    expect(ids[4]).toBe(2); // distance 2 from id 2 vs 4 from id 1
  });

  test("no sources leaves everything unassigned", () => {
    const ids = new Uint16Array(4);
    const ownable = new Uint8Array([1, 1, 1, 1]);
    nearestFillGlobal(ids, ownable, 4, 1);
    expect([...ids]).toEqual([0, 0, 0, 0]);
  });
});

describe("downsample4x", () => {
  test("majority nonzero id of each 2x2 block", () => {
    // 4x2 → 2x1. Left block: [1,1,2,0] → 1. Right block: [2,2,1,2] → 2.
    const ids = new Uint16Array([1, 1, 2, 2, 2, 0, 1, 2]);
    const out = downsample4x(ids, 4, 2, 2, 1);
    expect([...out]).toEqual([1, 2]);
  });

  test("ties break to the smallest id", () => {
    const ids = new Uint16Array([2, 1, 1, 2]);
    const out = downsample4x(ids, 2, 2, 1, 1);
    expect(out[0]).toBe(1);
  });

  test("all-zero block stays zero", () => {
    const ids = new Uint16Array([0, 0, 0, 0]);
    const out = downsample4x(ids, 2, 2, 1, 1);
    expect(out[0]).toBe(0);
  });

  test("odd dimensions clamp at the edge", () => {
    // 3x1 → 2x1: second block has only one column (x=2).
    const ids = new Uint16Array([1, 1, 3]);
    const out = downsample4x(ids, 3, 1, 2, 1);
    expect([...out]).toEqual([1, 3]);
  });
});

describe("computeRegionBorderMask", () => {
  test("marks tiles adjacent (right/down) to a different nonzero id", () => {
    // 4x1: [1,1,2,2] → tile 1 borders tile 2 (1≠2) → marked.
    const mask = computeRegionBorderMask([1, 1, 2, 2], 4, 1);
    expect([...mask]).toEqual([0, 1, 0, 0]);
  });

  test("does not mark region/void (id 0) boundaries", () => {
    const mask = computeRegionBorderMask([1, 0, 2, 2], 4, 1);
    expect([...mask]).toEqual([0, 0, 0, 0]);
  });

  test("marks vertical boundaries", () => {
    // 1x4 column: [1,1,2,2]
    const mask = computeRegionBorderMask([1, 1, 2, 2], 1, 4);
    expect([...mask]).toEqual([0, 1, 0, 0]);
  });
});
