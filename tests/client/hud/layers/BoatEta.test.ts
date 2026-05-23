import { describe, expect, test } from "vitest";
import { AttacksDisplay } from "../../../../src/client/hud/layers/AttacksDisplay";
import { estimateBoatEtaSeconds } from "../../../../src/client/hud/layers/boatEta";
import type { UnitView } from "../../../../src/core/game/GameView";

describe("estimateBoatEtaSeconds", () => {
  test("returns correct seconds for standard distance", () => {
    expect(estimateBoatEtaSeconds(100, 100)).toBe(10);
  });

  test("ceils fractional results", () => {
    expect(estimateBoatEtaSeconds(15, 100)).toBe(2);
  });

  test("returns 0 for zero distance", () => {
    expect(estimateBoatEtaSeconds(0, 100)).toBe(0);
  });

  test("returns correct seconds for large distance", () => {
    expect(estimateBoatEtaSeconds(1000, 100)).toBe(100);
  });

  test("handles different tick intervals", () => {
    expect(estimateBoatEtaSeconds(100, 50)).toBe(5);
  });

  test("throws for negative distance", () => {
    expect(() => estimateBoatEtaSeconds(-5, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for NaN distance", () => {
    expect(() => estimateBoatEtaSeconds(NaN, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for Infinity distance", () => {
    expect(() => estimateBoatEtaSeconds(Infinity, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for -Infinity distance", () => {
    expect(() => estimateBoatEtaSeconds(-Infinity, 100)).toThrow(
      "Invalid remainingTicks",
    );
  });

  test("throws for zero msPerTick", () => {
    expect(() => estimateBoatEtaSeconds(100, 0)).toThrow("Invalid msPerTick");
  });

  test("throws for negative msPerTick", () => {
    expect(() => estimateBoatEtaSeconds(100, -100)).toThrow(
      "Invalid msPerTick",
    );
  });

  test("throws for NaN msPerTick", () => {
    expect(() => estimateBoatEtaSeconds(100, NaN)).toThrow("Invalid msPerTick");
  });

  test("throws for Infinity msPerTick", () => {
    expect(() => estimateBoatEtaSeconds(100, Infinity)).toThrow(
      "Invalid msPerTick",
    );
  });
});

describe("AttacksDisplay.getBoatMotion", () => {
  function createLayer(
    game: Record<string, unknown>,
  ): InstanceType<typeof AttacksDisplay> {
    const layer = new AttacksDisplay();
    (layer as any).game = game;
    return layer;
  }

  function stubGame(ticks: number, plans: Map<number, unknown>) {
    return {
      ticks: () => ticks,
      motionPlans: () => plans,
    };
  }

  test("converts remaining ticks to seconds using MS_PER_TICK", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 2,
      path: new Uint32Array(9), // 8 steps, totalTicks = 16
    };
    const game = stubGame(10, new Map([[42, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 42 } as unknown as UnitView;

    // totalTicks = 8 * 2 = 16
    // elapsedTicks = 10 - 0 = 10
    // remainingTicks = 6
    // etaSeconds = ceil(6 * 100 / 1000) = 1
    // progress = 10 / 16 = 0.625
    const motion = (layer as any).getBoatMotion(boat);
    expect(motion).toEqual({ progress: 10 / 16, etaSeconds: 1 });
  });

  test("uses tick-level granularity mid-step (more accurate than step-floored)", () => {
    // ticksPerStep=20, 2 steps, totalTicks=40, at tick=11 (mid-step)
    // Tick-based:    remainingTicks = 29, seconds = ceil(29 * 100 / 1000) = 3
    // Step-floored:  floor(11/20)=0 elapsed, 2 remaining * 20 = 40 ticks,
    //                seconds = ceil(40 * 100 / 1000) = 4 (overestimate)
    const plan = {
      startTick: 0,
      ticksPerStep: 20,
      path: new Uint32Array(3),
    };
    const game = stubGame(11, new Map([[99, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 99 } as unknown as UnitView;

    expect((layer as any).getBoatMotion(boat)?.etaSeconds).toBe(3);
  });

  test("clamps progress to 1 and etaSeconds to 0 when overshooting", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(2), // totalTicks = 1
    };
    const game = stubGame(999, new Map([[7, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 7 } as unknown as UnitView;

    expect((layer as any).getBoatMotion(boat)).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });

  test("returns null when no motion plan exists", () => {
    const game = stubGame(0, new Map());
    const layer = createLayer(game);
    const boat = { id: () => 1 } as unknown as UnitView;

    expect((layer as any).getBoatMotion(boat)).toBeNull();
  });

  test("returns full progress immediately for zero-length paths", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(1), // path length 1 -> totalTicks = 0
    };
    const game = stubGame(0, new Map([[3, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 3 } as unknown as UnitView;

    expect((layer as any).getBoatMotion(boat)).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });
});
