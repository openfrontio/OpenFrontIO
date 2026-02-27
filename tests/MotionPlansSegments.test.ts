import { describe, expect, it } from "vitest";
import {
  packMotionPlans,
  unpackMotionPlans,
} from "../src/core/game/MotionPlans";

describe("MotionPlans grid_segments", () => {
  it("packs/unpacks grid_segments", () => {
    const packed = packMotionPlans([
      {
        kind: "grid_segments",
        unitId: 123,
        planId: 7,
        startTick: 10,
        ticksPerStep: 2,
        points: Uint32Array.from([1, 6, 11]),
        segmentSteps: Uint32Array.from([5, 5]),
      },
    ]);

    const records = unpackMotionPlans(packed);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.kind).toBe("grid_segments");
    if (r.kind !== "grid_segments") throw new Error("type guard");
    expect(r.unitId).toBe(123);
    expect(r.planId).toBe(7);
    expect(r.startTick).toBe(10);
    expect(r.ticksPerStep).toBe(2);
    expect(Array.from(r.points)).toEqual([1, 6, 11]);
    expect(Array.from(r.segmentSteps)).toEqual([5, 5]);
  });

  it("skips unknown kinds using wordCount", () => {
    const gridPacked = packMotionPlans([
      {
        kind: "grid_segments",
        unitId: 1,
        planId: 1,
        startTick: 1,
        ticksPerStep: 1,
        points: Uint32Array.from([10, 12]),
        segmentSteps: Uint32Array.from([2]),
      },
    ]);

    const gridRecordWords = gridPacked.slice(1); // strip recordCount
    const unknownWordCount = 4;
    const out = new Uint32Array(1 + unknownWordCount + gridRecordWords.length);
    out[0] = 2;
    let o = 1;
    out[o++] = 999;
    out[o++] = unknownWordCount;
    out[o++] = 111;
    out[o++] = 222;
    out.set(gridRecordWords, o);

    const records = unpackMotionPlans(out);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("grid_segments");
  });
});
