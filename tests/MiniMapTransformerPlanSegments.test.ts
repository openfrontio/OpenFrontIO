import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../src/core/game/GameMap";
import { MiniMapTransformer } from "../src/core/pathfinding/transformers/MiniMapTransformer";

function makeMap(width: number, height: number): GameMapImpl {
  return new GameMapImpl(width, height, new Uint8Array(width * height), 0);
}

describe("MiniMapTransformer", () => {
  it("preserves dense path endpoints after upscaling/fixing extremes", () => {
    const map = makeMap(10, 10);
    const miniMap = makeMap(5, 5);

    const miniPath = [
      miniMap.ref(0, 0),
      miniMap.ref(1, 0),
      miniMap.ref(2, 0),
      miniMap.ref(2, 1),
      miniMap.ref(2, 2),
    ];

    const inner = {
      findPath() {
        return miniPath.slice();
      },
    };

    const transformer = new MiniMapTransformer(inner as any, map, miniMap);
    const from = map.ref(0, 0);
    const to = map.ref(4, 4);

    const dense = transformer.findPath(from, to);
    expect(dense).not.toBeNull();
    if (!dense) return;
    expect(dense[0]).toBe(from);
    expect(dense[dense.length - 1]).toBe(to);
  });
});
