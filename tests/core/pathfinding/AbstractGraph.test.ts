import { AbstractGraphBuilder } from "@openfront/engine/pathfinding/algorithms/AbstractGraph";
import { AStarWaterHierarchical } from "@openfront/engine/pathfinding/algorithms/AStar.WaterHierarchical";
import { describe, expect, it } from "vitest";
import { createGameMap, L, W } from "./_fixtures";

// Two parallel channels (rows 10 and 20) that only meet through a U-bend in the
// last cluster, so the bend's gateways are 10 tiles apart but 68 tiles by water
function riverWithBend() {
  const width = 160;
  const height = 32;
  const grid: string[] = new Array(width * height).fill(L);
  for (let x = 0; x <= 156; x++) {
    grid[10 * width + x] = W;
    grid[20 * width + x] = W;
  }
  for (let y = 10; y <= 20; y++) grid[y * width + 156] = W;
  return createGameMap({ width, height, grid });
}

describe("AbstractGraph", () => {
  it("links gateways whose river winds far beyond their straight-line distance", () => {
    const map = riverWithBend();
    const graph = new AbstractGraphBuilder(map).build();
    const upper = graph.getAllNodes().find((n) => n.x === 127 && n.y === 10)!;
    const lower = graph.getAllNodes().find((n) => n.x === 127 && n.y === 20)!;

    expect(graph.getEdgeBetween(upper.id, lower.id)?.cost).toBe(68);
  });

  it("routes boats around the bend", () => {
    const map = riverWithBend();
    const hpa = new AStarWaterHierarchical(
      map,
      new AbstractGraphBuilder(map).build(),
    );
    const from = map.ref(2, 10);
    const to = map.ref(2, 20);

    const path = hpa.findPath(from, to);

    expect(path).not.toBeNull();
    expect(path![0]).toBe(from);
    expect(path![path!.length - 1]).toBe(to);
    expect(path).toHaveLength(2 * 154 + 10 + 1);
  });
});
