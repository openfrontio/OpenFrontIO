import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../src/core/game/GameMap";
import { densePathToKeypointSegments } from "../src/core/game/MotionPlans";
import { MiniMapTransformer } from "../src/core/pathfinding/transformers/MiniMapTransformer";

function makeMap(width: number, height: number): GameMapImpl {
  return new GameMapImpl(width, height, new Uint8Array(width * height), 0);
}

function expandPlanDda(
  map: GameMapImpl,
  points: Uint32Array,
  segmentSteps: Uint32Array,
): number[] {
  const out: number[] = [];
  if (points.length === 0) return out;
  out.push(points[0] >>> 0);
  for (let i = 0; i < segmentSteps.length; i++) {
    const steps = segmentSteps[i] >>> 0;
    const a = points[i] >>> 0;
    const b = points[i + 1] >>> 0;
    const ax = map.x(a);
    const ay = map.y(a);
    const bx = map.x(b);
    const by = map.y(b);
    const dx = bx - ax;
    const dy = by - ay;
    for (let t = 1; t <= steps; t++) {
      out.push(
        map.ref(
          Math.round(ax + (dx * t) / steps),
          Math.round(ay + (dy * t) / steps),
        ) >>> 0,
      );
    }
  }
  return out;
}

describe("densePathToKeypointSegments", () => {
  it("expands back to the dense path for axis segments", () => {
    const map = makeMap(10, 10);

    const dense = [
      map.ref(1, 1),
      map.ref(2, 1),
      map.ref(3, 1),
      map.ref(4, 1),
      map.ref(4, 2),
      map.ref(4, 3),
      map.ref(4, 4),
    ];

    const plan = densePathToKeypointSegments(dense);
    expect(plan).not.toBeNull();
    if (!plan) return;

    const expanded = expandPlanDda(map, plan.points, plan.segmentSteps);
    expect(expanded).toEqual(dense.map((t) => t >>> 0));
  });
});

describe("MiniMapTransformer planSegments compression", () => {
  it("preserves endpoints and total steps while merging collinear runs", () => {
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
      planSegments() {
        return {
          points: Uint32Array.from(miniPath),
          segmentSteps: Uint32Array.from([1, 1, 1, 1]),
        };
      },
    };

    const transformer = new MiniMapTransformer(inner as any, map, miniMap);
    const from = map.ref(0, 0);
    const to = map.ref(4, 4);

    const dense = transformer.findPath(from, to);
    expect(dense).not.toBeNull();

    const plan = transformer.planSegments(from, to);
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(Array.from(plan.points)).toEqual([
      from >>> 0,
      map.ref(4, 0) >>> 0,
      to >>> 0,
    ]);
    expect(Array.from(plan.segmentSteps)).toEqual([4, 4]);

    const totalSteps = Array.from(plan.segmentSteps).reduce((a, b) => a + b, 0);
    expect(totalSteps).toBe(8);
  });
});
