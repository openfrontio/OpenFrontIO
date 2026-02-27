import { describe, expect, it } from "vitest";
import {
  UnitMotionRenderQueue,
  UnitMotionRenderQueueEntry,
} from "../src/client/graphics/layers/UnitMotionRenderQueue";

describe("UnitMotionRenderQueue", () => {
  it("returns highest-priority entry first", () => {
    const queue = new UnitMotionRenderQueue();
    queue.enqueue({
      unitId: 1,
      version: 1,
      priority: 10,
      onScreenHint: false,
    });
    queue.enqueue({
      unitId: 2,
      version: 1,
      priority: 20,
      onScreenHint: true,
    });

    const first = queue.pollValid(() => true);
    expect(first?.unitId).toBe(2);
  });

  it("skips stale entries when validator rejects old versions", () => {
    const queue = new UnitMotionRenderQueue();
    const latestVersion = new Map<number, number>([[42, 2]]);

    const stale: UnitMotionRenderQueueEntry = {
      unitId: 42,
      version: 1,
      priority: 100,
      onScreenHint: true,
    };
    const fresh: UnitMotionRenderQueueEntry = {
      unitId: 42,
      version: 2,
      priority: 50,
      onScreenHint: true,
    };

    queue.enqueue(stale);
    queue.enqueue(fresh);

    const picked = queue.pollValid((entry) => {
      return latestVersion.get(entry.unitId) === entry.version;
    });

    expect(picked).toEqual(fresh);
  });
});
