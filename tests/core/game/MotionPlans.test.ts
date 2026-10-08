import {
  packMotionPlans,
  unpackMotionPlans,
} from "@openfront/engine-lib/game/MotionPlans";
import { describe, expect, it } from "vitest";

describe("MotionPlans", () => {
  it("round-trips fractional train speeds and keeps legacy integer speeds readable", () => {
    const packed = packMotionPlans([
      {
        kind: "train",
        engineUnitId: 1,
        carUnitIds: [2, 3],
        planId: 1,
        startTick: 10,
        speed: 2.6,
        spacing: 2,
        path: [0, 1, 2, 3, 4, 5],
      },
    ]);
    expect(unpackMotionPlans(packed)[0]).toMatchObject({ speed: 2.6 });

    const legacy = new Uint32Array([
      1,
      2,
      11,
      1,
      1,
      10,
      1,
      2,
      0,
      2,
      0,
      1,
    ]);
    expect(unpackMotionPlans(legacy)[0]).toMatchObject({ speed: 1 });
  });
});
