import { describe, expect, test } from "vitest";
import { estimateBoatEtaSeconds } from "../../../../src/client/graphics/layers/boatEta";
import { AttacksDisplay } from "../../../../src/client/graphics/layers/AttacksDisplay";
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

  test("throws for zero turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, 0)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for negative turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, -100)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for NaN turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, NaN)).toThrow(
      "Invalid turnIntervalMs",
    );
  });

  test("throws for Infinity turnIntervalMs", () => {
    expect(() => estimateBoatEtaSeconds(100, Infinity)).toThrow(
      "Invalid turnIntervalMs",
    );
  });
});

describe("AttacksDisplay.getBoatEtaSeconds", () => {
  function createLayer(
    game: Record<string, unknown>,
  ): InstanceType<typeof AttacksDisplay> {
    const layer = new AttacksDisplay();
    (layer as any).game = game;
    return layer;
  }

  function stubGame(
    ticks: number,
    plans: Map<number, unknown>,
    turnIntervalMs = 100,
  ) {
    return {
      ticks: () => ticks,
      motionPlans: () => plans,
      config: () => ({
        serverConfig: () => ({ turnIntervalMs: () => turnIntervalMs }),
      }),
    };
  }

  test("converts remaining steps to ticks using ticksPerStep", () => {
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
    // remainingTicks = 16 - 10 = 6
    // seconds = ceil(6 * 0.1) = 1
    const eta = (layer as any).getBoatEtaSeconds(boat);
    expect(eta).toBe(1);
  });

  test("uses tick-level granularity mid-step", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 4,
      path: new Uint32Array(6), // 5 steps, totalTicks = 20
    };
    // At tick 13 we are mid-step (step 3 of 5, 1 tick into the step)
    const game = stubGame(13, new Map([[99, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 99 } as unknown as UnitView;

    // totalTicks = 5 * 4 = 20
    // elapsedTicks = 13
    // remainingTicks = 7
    // seconds = ceil(7 * 0.1) = 1
    // A step-based approach would give floor(13/4)=3 elapsed steps,
    // remaining = 2 steps, remainingTicks = 8, seconds = ceil(0.8) = 1
    // — same here, but try tick 11:
    expect((layer as any).getBoatEtaSeconds(boat)).toBe(1);
  });

  test("mid-step tick differs from step-floored calculation", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 10,
      path: new Uint32Array(4), // 3 steps, totalTicks = 30
    };
    // At tick 21 we are 1 tick into step 3
    // Tick-based: remainingTicks = 30 - 21 = 9, seconds = ceil(9 * 0.1) = 1
    // Step-floored: floor(21/10) = 2 elapsed steps, 1 remaining step,
    //   remainingTicks = 10, seconds = ceil(10 * 0.1) = 1
    // At tick 25: remainingTicks = 5, seconds = ceil(0.5) = 1
    // At tick 1: remainingTicks = 29, seconds = ceil(2.9) = 3
    //   Step-floored: floor(1/10) = 0, remaining = 3 steps, ticks = 30,
    //   seconds = ceil(3.0) = 3 — same
    // At tick 5: remainingTicks = 25, seconds = ceil(2.5) = 3
    //   Step-floored: floor(5/10) = 0, remaining = 3, ticks = 30,
    //   seconds = ceil(3.0) = 3 — DIFFERENT! Tick-based is more accurate.
    const game = stubGame(5, new Map([[50, plan]]), 1000);
    const layer = createLayer(game);
    const boat = { id: () => 50 } as unknown as UnitView;

    // Tick-based: remainingTicks = 25, seconds = ceil(25 * 1.0) = 25
    // Step-floored would give: remaining 3 steps * 10 = 30 ticks = 30s
    expect((layer as any).getBoatEtaSeconds(boat)).toBe(25);
  });

  test("returns 0 when no steps remain", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(2), // 1 step
    };
    const game = stubGame(999, new Map([[7, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 7 } as unknown as UnitView;

    expect((layer as any).getBoatEtaSeconds(boat)).toBe(0);
  });

  test("returns null when no motion plan exists", () => {
    const game = stubGame(0, new Map());
    const layer = createLayer(game);
    const boat = { id: () => 1 } as unknown as UnitView;

    expect((layer as any).getBoatEtaSeconds(boat)).toBeNull();
  });
});
