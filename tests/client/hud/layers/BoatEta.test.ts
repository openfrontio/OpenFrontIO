import { beforeEach, describe, expect, test } from "vitest";
import { AttacksDisplay } from "../../../../src/client/hud/layers/AttacksDisplay";
import { estimateBoatEtaSeconds } from "../../../../src/client/hud/layers/boatEta";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../../src/core/game/Game";
import {
  GridPathPlan,
  unpackMotionPlans,
} from "../../../../src/core/game/MotionPlans";
import { setup } from "../../../util/Setup";

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

/**
 * Bridges the real Game returned by setup() to the minimum GameView surface
 * AttacksDisplay reads (`ticks()` and `motionPlans()`). GameView's motionPlans
 * map is a client-side derivation from packed records, so we replay the same
 * derivation here: drain records from the real Game and merge them in.
 */
class GameViewAdapter {
  private planMap = new Map<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  >();

  constructor(private readonly game: Game) {}

  ticks(): number {
    return this.game.ticks();
  }

  motionPlans() {
    const packed = this.game.drainPackedMotionPlans();
    if (packed) {
      for (const record of unpackMotionPlans(packed)) {
        if (record.kind !== "grid") continue;
        this.planMap.set(record.unitId, {
          planId: record.planId,
          startTick: record.startTick,
          ticksPerStep: record.ticksPerStep,
          path: record.path as Uint32Array,
        });
      }
    }
    return this.planMap;
  }
}

async function makeScenario(): Promise<{
  game: Game;
  adapter: GameViewAdapter;
  player: Player;
}> {
  const game = await setup("half_land_half_ocean", {
    infiniteGold: true,
    instantBuild: true,
  });
  game.addPlayer(
    new PlayerInfo("attacker", PlayerType.Human, null, "attacker"),
  );
  const player = game.player("attacker");
  // Hand the player a coastal foothold so buildUnit(TransportShip) is allowed.
  for (let x = 0; x < 7; x++) {
    for (let y = 0; y < 8; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
        player.conquer(tile);
      }
    }
  }
  return { game, adapter: new GameViewAdapter(game), player };
}

function buildBoat(game: Game, player: Player): Unit {
  // Place the boat one tile into open ocean (x=8 is the first water column).
  return player.buildUnit(UnitType.TransportShip, game.ref(8, 4), {
    troops: 100,
    targetTile: game.ref(15, 4),
  });
}

function recordGridPlan(
  game: Game,
  boatId: number,
  plan: Omit<GridPathPlan, "kind" | "unitId">,
): void {
  game.recordMotionPlan({ kind: "grid", unitId: boatId, ...plan });
}

function advanceTo(game: Game, targetTick: number): void {
  while (game.ticks() < targetTick) game.executeNextTick();
}

describe("AttacksDisplay.getBoatMotion", () => {
  let game: Game;
  let adapter: GameViewAdapter;
  let player: Player;
  let layer: AttacksDisplay;

  beforeEach(async () => {
    ({ game, adapter, player } = await makeScenario());
    layer = new AttacksDisplay();
    (layer as any).game = adapter;
  });

  test("converts remaining ticks to seconds using MS_PER_TICK", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 2,
      path: new Uint32Array(9), // 8 steps, totalTicks = 16
    });
    advanceTo(game, 10);

    // totalTicks=16, elapsed=10, remaining=6 → ceil(6*100/1000)=1, progress=10/16
    const motion = (layer as any).getBoatMotion(boat);
    expect(motion).toEqual({ progress: 10 / 16, etaSeconds: 1 });
  });

  test("uses tick-level granularity mid-step (more accurate than step-floored)", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 20,
      path: new Uint32Array(3), // 2 steps, totalTicks = 40
    });
    advanceTo(game, 11);

    // remainingTicks=29, seconds=ceil(29*100/1000)=3 (vs step-floored 4)
    expect((layer as any).getBoatMotion(boat)?.etaSeconds).toBe(3);
  });

  test("clamps progress to 1 and etaSeconds to 0 when overshooting", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(2), // totalTicks = 1
    });
    advanceTo(game, 50);

    expect((layer as any).getBoatMotion(boat)).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });

  test("returns null when no motion plan exists", () => {
    const boat = buildBoat(game, player);
    // No recordGridPlan call.
    expect((layer as any).getBoatMotion(boat)).toBeNull();
  });

  test("returns full progress immediately for zero-length paths", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(1), // path length 1 → totalTicks = 0
    });

    expect((layer as any).getBoatMotion(boat)).toEqual({
      progress: 1,
      etaSeconds: 0,
    });
  });

  test("retreating boat: fill decays from outbound snapshot toward zero", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11), // 10 steps
    });

    // Observe outbound at 60% progress.
    advanceTo(game, 6);
    expect((layer as any).getBoatMotion(boat).progress).toBeCloseTo(0.6);

    // Flip to retreating and record the retreat plan starting now.
    boat.updateTransportShipState({ isRetreating: true });
    recordGridPlan(game, boat.id(), {
      planId: 2,
      startTick: game.ticks(),
      ticksPerStep: 1,
      path: new Uint32Array(11), // 10 steps back home
    });

    // First retreat observation: fraction=0 → fill = snapshot.
    expect((layer as any).getBoatMotion(boat).progress).toBeCloseTo(0.6);

    // Halfway through retreat: fraction=5/10=0.5, fill = 0.6 * 0.5 = 0.3.
    advanceTo(game, 11);
    expect((layer as any).getBoatMotion(boat).progress).toBeCloseTo(0.3);

    // Arrival: fraction=1, fill = 0.
    advanceTo(game, 16);
    expect((layer as any).getBoatMotion(boat).progress).toBe(0);
  });

  test("retreating without a prior outbound observation snapshots at 0", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(6),
    });
    boat.updateTransportShipState({ isRetreating: true });
    advanceTo(game, 2);

    // No outbound observation captured → snapshot=0 → fill stays at 0.
    expect((layer as any).getBoatMotion(boat).progress).toBe(0);
  });

  test("retreating fill never bounces back up when the plan is re-recorded", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11),
    });
    advanceTo(game, 6);
    (layer as any).getBoatMotion(boat); // capture snapshot=0.6

    // Begin retreat.
    boat.updateTransportShipState({ isRetreating: true });
    recordGridPlan(game, boat.id(), {
      planId: 2,
      startTick: game.ticks(),
      ticksPerStep: 1,
      path: new Uint32Array(11), // 10 steps back home
    });

    // 5 ticks into retreat: fraction=0.5, fill=0.3.
    advanceTo(game, 11);
    expect((layer as any).getBoatMotion(boat).progress).toBeCloseTo(0.3);

    // Pathfinder rebuild: replace the retreat plan mid-flight with a fresh
    // startTick and a *longer* path. Without the monotonic clamp, fill would
    // jump back up.
    recordGridPlan(game, boat.id(), {
      planId: 3,
      startTick: game.ticks(),
      ticksPerStep: 1,
      path: new Uint32Array(13),
    });
    expect((layer as any).getBoatMotion(boat).progress).toBeLessThanOrEqual(
      0.3,
    );
  });

  test("retreating fill respects the latest plan's remaining distance", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(11),
    });
    advanceTo(game, 8);
    (layer as any).getBoatMotion(boat); // capture snapshot=0.8

    // Retreat plan: 20-tick path home (further than outbound's 10).
    boat.updateTransportShipState({ isRetreating: true });
    recordGridPlan(game, boat.id(), {
      planId: 2,
      startTick: game.ticks(),
      ticksPerStep: 1,
      path: new Uint32Array(21),
    });

    // 5 ticks in: elapsed=5, remaining=15, total=20, fraction=0.25, fill=0.6.
    advanceTo(game, 13);
    expect((layer as any).getBoatMotion(boat).progress).toBeCloseTo(0.6);

    // 20 ticks in: elapsed=20, remaining=0, fraction=1, fill=0. The fill
    // tracks the *full* retreat path, not the original outbound's 10 ticks.
    advanceTo(game, 28);
    expect((layer as any).getBoatMotion(boat).progress).toBe(0);
  });

  test("pruneBoatProgressMaps drops entries for boats no longer active", () => {
    const boat = buildBoat(game, player);
    recordGridPlan(game, boat.id(), {
      planId: 1,
      startTick: 0,
      ticksPerStep: 1,
      path: new Uint32Array(5),
    });
    advanceTo(game, 2);
    (layer as any).getBoatMotion(boat);
    expect((layer as any).lastOutboundProgress.size).toBe(1);

    (layer as any).pruneBoatProgressMaps(new Set<number>());
    expect((layer as any).lastOutboundProgress.size).toBe(0);
    expect((layer as any).retreatState.size).toBe(0);
  });
});
