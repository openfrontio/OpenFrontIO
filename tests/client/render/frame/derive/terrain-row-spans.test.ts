/**
 * buildTerrainRowSpans groups terrain-changed tile refs into one span per map
 * row (min..max x) so the renderer uploads a few hundred row rects instead of
 * one 1×1 texel per changed tile. Bytes come from the provided lookup for
 * EVERY tile in the span — including unchanged gap tiles, which must carry
 * their current value.
 */

import { describe, expect, it } from "vitest";
import { buildTerrainRowSpans } from "../../../../../src/client/render/frame/derive/TerrainRowSpans";

const MAP_W = 10;

/** Terrain byte lookup that encodes the ref itself (mod 256) for asserting. */
const byteAt = (ref: number) => ref % 256;

describe("buildTerrainRowSpans", () => {
  it("returns no rects for no refs", () => {
    const { rects, bytes } = buildTerrainRowSpans([], MAP_W, byteAt);
    expect(rects).toEqual([]);
    expect(bytes.length).toBe(0);
  });

  it("produces a 1×1 rect for a single ref", () => {
    // ref 23 → x=3, y=2
    const { rects, bytes } = buildTerrainRowSpans([23], MAP_W, byteAt);
    expect(rects).toEqual([{ x: 3, y: 2, w: 1, h: 1 }]);
    expect([...bytes]).toEqual([23]);
  });

  it("merges refs in the same row into one min..max span with gap bytes", () => {
    // Row y=1: x=2 and x=5 changed. Span covers x=2..5; gap tiles (x=3,4)
    // are included with their current bytes.
    const { rects, bytes } = buildTerrainRowSpans([15, 12], MAP_W, byteAt);
    expect(rects).toEqual([{ x: 2, y: 1, w: 4, h: 1 }]);
    expect([...bytes]).toEqual([12, 13, 14, 15]);
  });

  it("emits one span per row, ordered by ascending y, bytes concatenated", () => {
    // y=3: x=7..8; y=0: x=0. Passed out of order.
    const { rects, bytes } = buildTerrainRowSpans([38, 0, 37], MAP_W, byteAt);
    expect(rects).toEqual([
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 7, y: 3, w: 2, h: 1 },
    ]);
    expect([...bytes]).toEqual([0, 37, 38]);
  });

  it("covers a blob the way a nuke crater changes tiles", () => {
    // 3×3 blob centered at (5,5): every span is exactly the blob's row.
    const refs: number[] = [];
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) refs.push(y * MAP_W + x);
    }
    const { rects, bytes } = buildTerrainRowSpans(refs, MAP_W, byteAt);
    expect(rects).toEqual([
      { x: 4, y: 4, w: 3, h: 1 },
      { x: 4, y: 5, w: 3, h: 1 },
      { x: 4, y: 6, w: 3, h: 1 },
    ]);
    expect([...bytes]).toEqual([44, 45, 46, 54, 55, 56, 64, 65, 66]);
  });
});
