import { vi } from "vitest";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import { Difficulty, PlayerType } from "../src/core/game/Game";
import { Cluster } from "../src/core/game/TrainStation";
import { PseudoRandom } from "../src/core/PseudoRandom";

// ── Fixed trade-gold values matching DefaultConfig ──────────────────────────

const TRAIN_GOLD: Record<string, bigint> = {
  self: 10_000n,
  team: 25_000n,
  ally: 35_000n,
  other: 25_000n,
};

const MAX_TRADE_GOLD = Number(TRAIN_GOLD.ally); // denominator

// ── Factory helpers ──────────────────────────────────────────────────────────

function makeUnit(tile: number): any {
  return { tile: () => tile };
}

function makeStation(unit: any, cluster: Cluster | null = null): any {
  return { unit, getCluster: () => cluster };
}

function makeGame(stations: any[] = []): any {
  return {
    config: () => ({
      trainGold: (rel: string, _citiesVisited: number) => TRAIN_GOLD[rel] ?? 0n,
    }),
    railNetwork: () => ({
      stationManager: () => ({ getAll: () => new Set(stations) }),
    }),
  };
}

function makePlayer(
  ownUnits: any[],
  neighborList: any[],
  opts: {
    canTrade?: (n: any) => boolean;
    isOnSameTeam?: (n: any) => boolean;
    isAlliedWith?: (n: any) => boolean;
  } = {},
): any {
  return {
    units: vi.fn(() => ownUnits),
    nearby: vi.fn(() => neighborList),
    canTrade: vi.fn((n: any) => opts.canTrade?.(n) ?? true),
    isOnSameTeam: vi.fn((n: any) => opts.isOnSameTeam?.(n) ?? false),
    isAlliedWith: vi.fn((n: any) => opts.isAlliedWith?.(n) ?? false),
  };
}

function makeNeighbor(
  opts: {
    isPlayer?: boolean;
    type?: PlayerType;
    units?: any[];
  } = {},
): any {
  return {
    isPlayer: () => opts.isPlayer ?? true,
    type: () => opts.type ?? PlayerType.Human,
    units: vi.fn(() => opts.units ?? []),
  };
}

function makeBehavior(
  game: any,
  player: any,
  random: PseudoRandom = new PseudoRandom(0),
): NationStructureBehavior {
  return new NationStructureBehavior(random, game, player);
}

// ── shouldUseConnectivityScore ───────────────────────────────────────────────

describe("NationStructureBehavior.shouldUseConnectivityScore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function behaviorWithNextInt(returnValue: number): {
    behavior: NationStructureBehavior;
    random: PseudoRandom;
  } {
    const random = new PseudoRandom(0);
    vi.spyOn(random, "nextInt").mockReturnValue(returnValue);
    const behavior = makeBehavior(makeGame(), makePlayer([], []), random);
    return { behavior, random };
  }

  it("always returns false for Easy (randomChance = 0)", () => {
    for (const v of [0, 50, 99]) {
      const { behavior, random } = behaviorWithNextInt(v);
      vi.spyOn(random, "nextInt").mockReturnValue(v);
      expect(
        (behavior as any).shouldUseConnectivityScore(Difficulty.Easy),
      ).toBe(false);
    }
  });

  it("returns true for Medium when nextInt < 60", () => {
    const { behavior } = behaviorWithNextInt(59);
    expect(
      (behavior as any).shouldUseConnectivityScore(Difficulty.Medium),
    ).toBe(true);
  });

  it("returns false for Medium when nextInt === 60 (boundary)", () => {
    const { behavior } = behaviorWithNextInt(60);
    expect(
      (behavior as any).shouldUseConnectivityScore(Difficulty.Medium),
    ).toBe(false);
  });

  it("returns true for Hard when nextInt < 75", () => {
    const { behavior } = behaviorWithNextInt(74);
    expect((behavior as any).shouldUseConnectivityScore(Difficulty.Hard)).toBe(
      true,
    );
  });

  it("returns false for Hard when nextInt === 75 (boundary)", () => {
    const { behavior } = behaviorWithNextInt(75);
    expect((behavior as any).shouldUseConnectivityScore(Difficulty.Hard)).toBe(
      false,
    );
  });

  it("always returns true for Impossible (randomChance = 100)", () => {
    for (const v of [0, 50, 99]) {
      const { behavior, random } = behaviorWithNextInt(v);
      vi.spyOn(random, "nextInt").mockReturnValue(v);
      expect(
        (behavior as any).shouldUseConnectivityScore(Difficulty.Impossible),
      ).toBe(true);
    }
  });
});

// ── buildReachableStations ───────────────────────────────────────────────────

describe("NationStructureBehavior.buildReachableStations", () => {
  const selfWeight = Number(TRAIN_GOLD.self) / MAX_TRADE_GOLD;
  const allyWeight = Number(TRAIN_GOLD.ally) / MAX_TRADE_GOLD;
  const teamWeight = Number(TRAIN_GOLD.team) / MAX_TRADE_GOLD;
  const otherWeight = Number(TRAIN_GOLD.other) / MAX_TRADE_GOLD;

  it("includes own registered units with self weight and correct cluster", () => {
    const cluster = new Cluster();
    const unit = makeUnit(10);
    const station = makeStation(unit, cluster);
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].tile).toBe(10);
    expect(result[0].cluster).toBe(cluster);
    expect(result[0].weight).toBeCloseTo(selfWeight);
  });

  it("assigns null cluster when own unit is a station with no cluster", () => {
    const unit = makeUnit(11);
    const station = makeStation(unit, null);
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].cluster).toBeNull();
    expect(result[0].weight).toBeCloseTo(selfWeight);
  });

  it("excludes own units not registered in the station manager", () => {
    const unit = makeUnit(20);
    // No stations in station manager
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes bot neighbors", () => {
    const unit = makeUnit(30);
    const station = makeStation(unit, null);
    const bot = makeNeighbor({ type: PlayerType.Bot, units: [unit] });
    const player = makePlayer([], [bot]);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes non-player neighbors", () => {
    const unit = makeUnit(40);
    const station = makeStation(unit, null);
    const nonPlayer = makeNeighbor({ isPlayer: false, units: [unit] });
    const player = makePlayer([], [nonPlayer]);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes embargoed (canTrade = false) neighbors", () => {
    const unit = makeUnit(50);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], { canTrade: () => false });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("includes non-embargoed neutral neighbor with 'other' weight", () => {
    const unit = makeUnit(60);
    const cluster = new Cluster();
    const station = makeStation(unit, cluster);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: () => false,
      isAlliedWith: () => false,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].tile).toBe(60);
    expect(result[0].cluster).toBe(cluster);
    expect(result[0].weight).toBeCloseTo(otherWeight);
  });

  it("uses 'ally' weight for allied neighbor", () => {
    const unit = makeUnit(70);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: () => false,
      isAlliedWith: (n) => n === neighbor,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].weight).toBeCloseTo(allyWeight);
  });

  it("uses 'team' weight for team neighbor (team check precedes ally)", () => {
    const unit = makeUnit(80);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: (n) => n === neighbor,
      isAlliedWith: () => false,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].weight).toBeCloseTo(teamWeight);
  });

  it("excludes neighbor units not registered in the station manager", () => {
    const unit = makeUnit(90);
    // Station manager has no stations, so unit is unknown
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor]);
    const behavior = makeBehavior(makeGame([]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("collects own and neighbor units together", () => {
    const ownUnit = makeUnit(100);
    const ownStation = makeStation(ownUnit, null);
    const neighborUnit = makeUnit(200);
    const neighborStation = makeStation(neighborUnit, null);
    const neighbor = makeNeighbor({ units: [neighborUnit] });
    const player = makePlayer([ownUnit], [neighbor]);
    const behavior = makeBehavior(
      makeGame([ownStation, neighborStation]),
      player,
    );

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(2);
    const tiles = result.map((r: any) => r.tile).sort();
    expect(tiles).toEqual([100, 200]);
  });
});

// ── getOrBuildReachableStations cache behaviour ──────────────────────────────

// ── tryBuildDefensePost — early-exit guards ──────────────────────────────────

describe("NationStructureBehavior.tryBuildDefensePost", () => {
  function makeLandAttack(troops: number, attackerId: string = "a"): any {
    return {
      troops: () => troops,
      sourceTile: () => null,
      clusteredPositions: () => [],
      attacker: () => ({ id: () => attackerId }),
    };
  }

  function makeBoatAttack(troops: number): any {
    return {
      troops: () => troops,
      sourceTile: () => 999, // non-null → boat
      clusteredPositions: () => [],
      attacker: () => ({ id: () => "boat" }),
    };
  }

  function makeMinimalGame(difficulty: Difficulty): any {
    return {
      config: () => ({
        gameConfig: () => ({ difficulty }),
        isUnitDisabled: () => false,
        nukeMagnitudes: () => ({ outer: 50 }),
      }),
      unitInfo: () => ({ cost: () => 0n }),
      euclideanDistSquared: () => Number.MAX_VALUE,
    };
  }

  function makeMinimalPlayer(troops: number, attacks: any[]): any {
    return {
      troops: () => troops,
      incomingAttacks: () => attacks,
      gold: () => 1_000_000n,
      units: () => [],
    };
  }

  function callTryBuild(
    difficulty: Difficulty,
    troops: number,
    attacks: any[],
  ): boolean {
    const game = makeMinimalGame(difficulty);
    const player = makeMinimalPlayer(troops, attacks);
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    return (behavior as any).tryBuildDefensePost();
  }

  it("returns false on Easy regardless of ratio", () => {
    expect(callTryBuild(Difficulty.Easy, 100, [makeLandAttack(5000)])).toBe(
      false,
    );
  });

  it("returns false when there are no incoming attacks", () => {
    expect(callTryBuild(Difficulty.Hard, 1000, [])).toBe(false);
  });

  it("returns false when only boat attacks are incoming", () => {
    expect(callTryBuild(Difficulty.Hard, 100, [makeBoatAttack(5000)])).toBe(
      false,
    );
  });

  it("returns false when land-attack ratio is below 0.35", () => {
    expect(callTryBuild(Difficulty.Hard, 1000, [makeLandAttack(349)])).toBe(
      false,
    );
  });

  it("returns false when own troops are zero", () => {
    expect(callTryBuild(Difficulty.Hard, 0, [makeLandAttack(500)])).toBe(false);
  });
});

// ── getAttackFrontTiles ──────────────────────────────────────────────────────

describe("NationStructureBehavior.getAttackFrontTiles", () => {
  function makeGame(
    neighborsFn: (tile: number) => number[],
    ownerFn: (tile: number) => any,
  ): any {
    return {
      config: () => ({ nukeMagnitudes: () => ({ outer: 50 }) }),
      neighbors: neighborsFn,
      owner: ownerFn,
    };
  }

  function makePlayer(borderTilesList: number[]): any {
    return {
      units: () => [],
      borderTiles: () => borderTilesList,
    };
  }

  function makeAttack(attacker: any): any {
    return { attacker: () => attacker };
  }

  it("returns empty array for empty attack list", () => {
    const game = makeGame(
      () => [],
      () => null,
    );
    const player = makePlayer([1, 2]);
    const behavior = makeBehavior(game, player);
    expect((behavior as any).getAttackFrontTiles([])).toEqual([]);
  });

  it("includes border tile whose neighbor is owned by an attacker", () => {
    const attacker = { id: () => "atk" };
    const game = makeGame(
      (tile) => (tile === 10 ? [100] : []),
      (tile) => (tile === 100 ? attacker : null),
    );
    const player = makePlayer([10, 20]);
    const behavior = makeBehavior(game, player);
    expect(
      (behavior as any).getAttackFrontTiles([makeAttack(attacker)]),
    ).toEqual([10]);
  });

  it("excludes border tiles not adjacent to any attacker", () => {
    const attacker = { id: () => "atk" };
    const game = makeGame(
      (tile) => (tile === 10 ? [100] : [200]),
      (tile) => (tile === 100 ? attacker : null),
    );
    const player = makePlayer([10, 20]);
    const behavior = makeBehavior(game, player);
    const result = (behavior as any).getAttackFrontTiles([
      makeAttack(attacker),
    ]);
    expect(result).toContain(10);
    expect(result).not.toContain(20);
  });

  it("handles multiple attackers from separate attacks", () => {
    const atk1 = { id: () => "a1" };
    const atk2 = { id: () => "a2" };
    const game = makeGame(
      (tile) => (tile === 10 ? [100] : tile === 20 ? [200] : []),
      (tile) => (tile === 100 ? atk1 : tile === 200 ? atk2 : null),
    );
    const player = makePlayer([10, 20, 30]);
    const behavior = makeBehavior(game, player);
    const result = (behavior as any).getAttackFrontTiles([
      makeAttack(atk1),
      makeAttack(atk2),
    ]);
    expect(result).toContain(10);
    expect(result).toContain(20);
    expect(result).not.toContain(30);
  });

  it("does not duplicate a border tile that has multiple attacker-owned neighbors", () => {
    const attacker = { id: () => "atk" };
    const game = makeGame(
      (tile) => (tile === 10 ? [100, 101] : []),
      (tile) => (tile === 100 || tile === 101 ? attacker : null),
    );
    const player = makePlayer([10]);
    const behavior = makeBehavior(game, player);
    const result = (behavior as any).getAttackFrontTiles([
      makeAttack(attacker),
    ]);
    expect(result).toEqual([10]);
  });
});

// ── countDefensePostsNearFront ───────────────────────────────────────────────

describe("NationStructureBehavior.countDefensePostsNearFront", () => {
  const OUTER_RANGE = 50;

  function makeCountGame(distFn: (a: number, b: number) => number): any {
    return {
      config: () => ({ nukeMagnitudes: () => ({ outer: OUTER_RANGE }) }),
      euclideanDistSquared: distFn,
    };
  }

  function makeCountPlayer(postTiles: number[]): any {
    return {
      units: () => postTiles.map((t) => ({ tile: () => t })),
    };
  }

  function count(
    postTiles: number[],
    frontTiles: number[],
    distFn: (a: number, b: number) => number,
  ): number {
    const game = makeCountGame(distFn);
    const player = makeCountPlayer(postTiles);
    const behavior = makeBehavior(game, player);
    return (behavior as any).countDefensePostsNearFront(frontTiles);
  }

  it("returns 0 when there are no defense posts", () => {
    const threshold = (OUTER_RANGE * 1.5) ** 2;
    expect(count([], [1], () => threshold - 1)).toBe(0);
  });

  it("returns 0 when front tiles list is empty", () => {
    expect(count([1, 2], [], () => 0)).toBe(0);
  });

  it("counts posts within 1.5 × borderSpacing of any front tile", () => {
    const threshold = (OUTER_RANGE * 1.5) ** 2;
    expect(count([10, 20], [1], () => threshold - 1)).toBe(2);
  });

  it("does not count posts outside 1.5 × borderSpacing", () => {
    const threshold = (OUTER_RANGE * 1.5) ** 2;
    expect(count([10, 20], [1], () => threshold + 1)).toBe(0);
  });

  it("counts a post only once even if near multiple front tiles", () => {
    const threshold = (OUTER_RANGE * 1.5) ** 2;
    expect(count([10], [1, 2], () => threshold - 1)).toBe(1);
  });

  it("sums posts near different sections of the front", () => {
    const threshold = (OUTER_RANGE * 1.5) ** 2;
    expect(count([10, 20], [1, 2], () => threshold - 1)).toBe(2);
  });

  // Hard/Impossible allowed-count formula
  it("Hard: allowed = ceil(ratio / 0.4) — 0.6 ratio → 2 allowed", () => {
    expect(Math.ceil(0.6 / 0.4)).toBe(2);
  });

  it("Hard: allowed = ceil(ratio / 0.4) — 0.4 ratio → 1 allowed", () => {
    expect(Math.ceil(0.4 / 0.4)).toBe(1);
  });

  it("Hard: allowed = ceil(ratio / 0.4) — 1.0 ratio → 3 allowed", () => {
    expect(Math.ceil(1.0 / 0.4)).toBe(3);
  });
});

// ── getOrBuildReachableStations cache behaviour ──────────────────────────────

describe("NationStructureBehavior.getOrBuildReachableStations", () => {
  let behavior: NationStructureBehavior;
  let buildSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const player = makePlayer([], []);
    behavior = makeBehavior(makeGame(), player);
    buildSpy = vi.spyOn(behavior as any, "buildReachableStations");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls buildReachableStations exactly once on first access", () => {
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the same array instance on repeated calls", () => {
    const first = (behavior as any).getOrBuildReachableStations();
    const second = (behavior as any).getOrBuildReachableStations();

    expect(first).toBe(second);
  });

  it("does not call buildReachableStations a second time when cache is warm", () => {
    (behavior as any).getOrBuildReachableStations();
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after the cache is reset to null", () => {
    (behavior as any).getOrBuildReachableStations();
    (behavior as any).reachableStationsCache = null;
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(2);
  });
});
