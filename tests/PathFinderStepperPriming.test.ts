import { describe, expect, it } from "vitest";
import { PathFinderStepper } from "../src/core/pathfinding/PathFinderStepper";
import { PathStatus } from "../src/core/pathfinding/types";

describe("PathFinderStepper cache priming", () => {
  it("does not prime next() cache via findPath()", () => {
    let calls = 0;
    const finder = {
      findPath(from: number | number[], to: number) {
        calls++;
        const start = Array.isArray(from) ? from[0] : from;
        return [start, to];
      },
    };

    const stepper = new PathFinderStepper<number>(finder, {
      equals: (a, b) => a === b,
    });

    const from = 10;
    const to = 42;

    const path = stepper.findPath(from, to);
    expect(path).toEqual([from, to]);
    expect(calls).toBe(1);

    const r1 = stepper.next(from, to);
    expect(r1.status).toBe(PathStatus.NEXT);
    if (r1.status === PathStatus.NEXT) {
      expect(r1.node).toBe(to);
    }
    expect(calls).toBe(2);
  });
});
