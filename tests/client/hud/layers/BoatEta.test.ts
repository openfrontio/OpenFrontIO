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

  function stubBoat(id: number, isRetreating = false): UnitView {
    return {
      id: () => id,
      transportShipState: () => ({ isRetreating, troops: 0 }),
    } as unknown as UnitView;
  }

  test("converts remaining ticks to seconds using MS_PER_TICK", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 2,
      path: new Uint32Array(9), // 8 steps, totalTicks = 16
    };
    const game = stubGame(10, new Map([[42, plan]]));
    const layer = createLayer(game);

    // totalTicks = 8 * 2 = 16
    // elapsedTicks = 10 - 0 = 10
    // remainingTicks = 6
    // etaSeconds = ceil(6 * 100 / 1000) = 1
    // progress = 10 / 16 = 0.625
    const motion = (layer as any).getBoatMotion(stubBoat(42));
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

    expect((layer as any).getBoatMotion(stubBoat(99))?.etaSeconds).toBe(3);
  });

  test("clamps progress to 1 and etaSeconds to 0 when overshooting", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(2), // totalTicks = 1
    };
    const game = stubGame(999, new Map([[7, plan]]));
    const layer = createLayer(game);

    expect((layer as any).getBoatMotion(stubBoat(7))).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });

  test("returns null when no motion plan exists", () => {
    const game = stubGame(0, new Map());
    const layer = createLayer(game);

    expect((layer as any).getBoatMotion(stubBoat(1))).toBeNull();
  });

  test("returns full progress immediately for zero-length paths", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(1), // path length 1 -> totalTicks = 0
    };
    const game = stubGame(0, new Map([[3, plan]]));
    const layer = createLayer(game);

    expect((layer as any).getBoatMotion(stubBoat(3))).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });

  test("retreating boat: fill decays from outbound snapshot toward zero", () => {
    // Outbound plan: 10 steps, ticksPerStep=1, totalTicks=10
    const outbound = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11),
    };
    const plans = new Map<number, unknown>([[5, outbound]]);
    const game: any = { ticks: () => 6, motionPlans: () => plans };
    const layer = createLayer(game);

    // Tick 6 outbound: boat is 60% of the way.
    const before = (layer as any).getBoatMotion(stubBoat(5, false));
    expect(before.progress).toBeCloseTo(0.6);

    // Retreat motion plan recorded with 10 steps back to base, startTick=6.
    plans.set(5, { startTick: 6, ticksPerStep: 1, path: new Uint32Array(11) });

    // First retreat tick: elapsed=0, remaining=10, total=10, fraction=0 → fill = snapshot.
    game.ticks = () => 6;
    expect(
      (layer as any).getBoatMotion(stubBoat(5, true)).progress,
    ).toBeCloseTo(0.6);

    // Halfway: elapsed=5, remaining=5, total=10, fraction=0.5 → fill = 0.6 * 0.5.
    game.ticks = () => 11;
    expect(
      (layer as any).getBoatMotion(stubBoat(5, true)).progress,
    ).toBeCloseTo(0.3);

    // Arrival: elapsed=10, remaining=0, total=10, fraction=1 → fill = 0.
    game.ticks = () => 16;
    expect((layer as any).getBoatMotion(stubBoat(5, true)).progress).toBe(0);
  });

  test("retreating without a prior outbound observation snapshots at 0", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(6),
    };
    const game = stubGame(2, new Map([[8, plan]]));
    const layer = createLayer(game);

    const motion = (layer as any).getBoatMotion(stubBoat(8, true));
    expect(motion.progress).toBe(0);
  });

  test("retreating fill never bounces back up when the plan is re-recorded", () => {
    // Outbound 60% along a 10-tick path.
    const outbound = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11),
    };
    const plans = new Map<number, unknown>([[5, outbound]]);
    const game: any = { ticks: () => 6, motionPlans: () => plans };
    const layer = createLayer(game);
    (layer as any).getBoatMotion(stubBoat(5, false)); // capture snapshot

    // Retreat plan: 10-tick path back to base.
    plans.set(5, { startTick: 6, ticksPerStep: 1, path: new Uint32Array(11) });

    // 5 ticks in: fraction 5/10 = 0.5, fill 0.3.
    game.ticks = () => 11;
    expect(
      (layer as any).getBoatMotion(stubBoat(5, true)).progress,
    ).toBeCloseTo(0.3);

    // Pathfinder rebuild: new plan with fresh startTick=11 and a *longer* path
    // (12 ticks remaining). Without the monotonic clamp, fraction would drop to
    // 5/(5+12)=~0.294, and fill would jump UP to ~0.42.
    plans.set(5, { startTick: 11, ticksPerStep: 1, path: new Uint32Array(13) });
    expect(
      (layer as any).getBoatMotion(stubBoat(5, true)).progress,
    ).toBeLessThanOrEqual(0.3);
  });

  test("retreating fill respects the latest plan's remaining distance", () => {
    // Outbound 80% along a 10-tick path.
    const outbound = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11),
    };
    const plans = new Map<number, unknown>([[5, outbound]]);
    const game: any = { ticks: () => 8, motionPlans: () => plans };
    const layer = createLayer(game);
    (layer as any).getBoatMotion(stubBoat(5, false)); // snapshot = 0.8

    // Retreat plan: 20-tick path back home (further than outbound used).
    plans.set(5, { startTick: 8, ticksPerStep: 1, path: new Uint32Array(21) });

    // 5 ticks in: elapsed=5, remaining=15, total=20, fraction=0.25, fill=0.6.
    game.ticks = () => 13;
    expect(
      (layer as any).getBoatMotion(stubBoat(5, true)).progress,
    ).toBeCloseTo(0.6);

    // 20 ticks in: elapsed=20, remaining=0, total=20, fraction=1, fill=0.
    // The point: the fill matches the *full retreat path length*, not the
    // original outbound's 10-tick total. Fill reaches 0 only at actual arrival.
    game.ticks = () => 28;
    expect((layer as any).getBoatMotion(stubBoat(5, true)).progress).toBe(0);
  });

  test("pruneBoatProgressMaps drops entries for boats no longer active", () => {
    const plan = {
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(5),
    };
    const game = stubGame(2, new Map([[10, plan]]));
    const layer = createLayer(game);

    // Seed state by observing the boat.
    (layer as any).getBoatMotion(stubBoat(10, false));
    expect((layer as any).lastOutboundProgress.size).toBe(1);

    // Boat 10 is no longer active.
    (layer as any).pruneBoatProgressMaps(new Set<number>());
    expect((layer as any).lastOutboundProgress.size).toBe(0);
    expect((layer as any).retreatState.size).toBe(0);
  });
});
