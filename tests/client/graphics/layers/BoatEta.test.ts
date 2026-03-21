import { describe, expect, test } from "vitest";
import {
  AttacksDisplay,
  estimateBoatEtaSeconds,
} from "../../../../src/client/graphics/layers/AttacksDisplay";
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
    const layer = document.createElement("attacks-display") as InstanceType<
      typeof AttacksDisplay
    >;
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
      path: new Uint32Array(9), // 8 steps total
    };
    const game = stubGame(10, new Map([[42, plan]]));
    const layer = createLayer(game);
    const boat = { id: () => 42 } as unknown as UnitView;

    // elapsed = floor((10 - 0) / 2) = 5 steps
    // remaining = 8 - 5 = 3 steps
    // remainingTicks = 3 * 2 = 6
    // seconds = ceil(6 * 0.1) = 1
    const eta = (layer as any).getBoatEtaSeconds(boat);
    expect(eta).toBe(1);
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
