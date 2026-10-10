import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { Cluster } from "@openfront/engine/game/TrainStation";
import { vi } from "vitest";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

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
        defensePostRange: () => 30,
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

  it("builds against a landed boat attack", () => {
    const addExecution = vi.fn();
    const game = { ...makeMinimalGame(Difficulty.Hard), addExecution };
    const player = {
      ...makeMinimalPlayer(100, [makeBoatAttack(5000)]),
      canBuild: () => true,
    };
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "findDefensePostTile").mockReturnValue(42);
    expect((behavior as any).tryBuildDefensePost()).toBe(true);
    expect(addExecution).toHaveBeenCalledTimes(1);
  });

  it("returns false when land-attack ratio is below 0.35", () => {
    expect(callTryBuild(Difficulty.Hard, 1000, [makeLandAttack(349)])).toBe(
      false,
    );
  });

  it("returns false when own troops are zero", () => {
    expect(callTryBuild(Difficulty.Hard, 0, [makeLandAttack(500)])).toBe(false);
  });

  // ── Medium 50% gate ──────────────────────────────────────────────────────

  it("Medium: returns false when random.chance(2) fails (50% gate closed)", () => {
    const game = makeMinimalGame(Difficulty.Medium);
    const player = makeMinimalPlayer(1000, [makeLandAttack(1000)]);
    const random = new PseudoRandom(0);
    vi.spyOn(random, "chance").mockReturnValue(false);
    const behavior = makeBehavior(game, player, random);
    (behavior as any).placementsCount = 1;
    expect((behavior as any).tryBuildDefensePost()).toBe(false);
  });

  it("Medium: 50% gate consumes only the chance(2) call", () => {
    const game = makeMinimalGame(Difficulty.Medium);
    const player = makeMinimalPlayer(1000, [makeLandAttack(1000)]);
    const random = new PseudoRandom(0);
    const chanceSpy = vi.spyOn(random, "chance").mockReturnValue(false);
    const behavior = makeBehavior(game, player, random);
    (behavior as any).placementsCount = 1;
    (behavior as any).tryBuildDefensePost();
    expect(chanceSpy).toHaveBeenCalledWith(2);
  });

  it("Hard: skips chance gate (no chance(2) consumed)", () => {
    const game = makeMinimalGame(Difficulty.Hard);
    const player = {
      ...makeMinimalPlayer(1000, [makeLandAttack(1000)]),
      borderTiles: () => [],
      canBuild: () => false,
    };
    const random = new PseudoRandom(0);
    const chanceSpy = vi.spyOn(random, "chance");
    const behavior = makeBehavior(game, player, random);
    (behavior as any).placementsCount = 1;
    (behavior as any).tryBuildDefensePost();
    expect(chanceSpy).not.toHaveBeenCalledWith(2);
  });

  // ── Cap enforcement ──────────────────────────────────────────────────────

  it("Hard: returns false once countDefensePostsNearFront reaches the allowed cap", () => {
    const game = makeMinimalGame(Difficulty.Hard);
    // ratio = 1.0 → ceil(1.0 / 0.4) = 3 allowed
    const player = makeMinimalPlayer(1000, [makeLandAttack(1000)]);
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "countDefensePostsNearFront").mockReturnValue(3);
    expect((behavior as any).tryBuildDefensePost()).toBe(false);
  });

  it("Hard: returns false once countDefensePostsNearFront exceeds the allowed cap", () => {
    const game = makeMinimalGame(Difficulty.Hard);
    // ratio = 0.4 → ceil(0.4 / 0.4) = 1 allowed
    const player = makeMinimalPlayer(1000, [makeLandAttack(400)]);
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "countDefensePostsNearFront").mockReturnValue(1);
    expect((behavior as any).tryBuildDefensePost()).toBe(false);
  });

  // ── Successful build path ────────────────────────────────────────────────

  it("Hard: dispatches a ConstructionExecution for DefensePost on successful build", () => {
    const addExecution = vi.fn();
    const game = {
      ...makeMinimalGame(Difficulty.Hard),
      addExecution,
    };
    const canBuild = vi.fn(() => true);
    const player = {
      ...makeMinimalPlayer(1000, [makeLandAttack(1000)]),
      gold: () => 1_000_000n,
      canBuild,
    };
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "countDefensePostsNearFront").mockReturnValue(0);
    vi.spyOn(behavior as any, "findDefensePostTile").mockReturnValue(42);

    expect((behavior as any).tryBuildDefensePost()).toBe(true);
    expect(addExecution).toHaveBeenCalledTimes(1);
    const exec = addExecution.mock.calls[0][0];
    expect(exec).toBeInstanceOf(ConstructionExecution);
  });

  it("returns false when player.gold() is below cost", () => {
    const game = {
      ...makeMinimalGame(Difficulty.Hard),
      // cost > 0 so gold check fails
      unitInfo: () => ({ cost: () => 1_000_000n }),
    };
    const player = {
      ...makeMinimalPlayer(1000, [makeLandAttack(1000)]),
      gold: () => 0n,
    };
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "countDefensePostsNearFront").mockReturnValue(0);
    expect((behavior as any).tryBuildDefensePost()).toBe(false);
  });

  it("returns false when no tile is found behind the front", () => {
    const addExecution = vi.fn();
    const game = {
      ...makeMinimalGame(Difficulty.Hard),
      addExecution,
    };
    const player = makeMinimalPlayer(1000, [makeLandAttack(1000)]);
    const behavior = makeBehavior(game, player);
    (behavior as any).placementsCount = 1;
    vi.spyOn(behavior as any, "getAttackFrontTiles").mockReturnValue([1]);
    vi.spyOn(behavior as any, "countDefensePostsNearFront").mockReturnValue(0);
    vi.spyOn(behavior as any, "findDefensePostTile").mockReturnValue(null);

    expect((behavior as any).tryBuildDefensePost()).toBe(false);
    expect(addExecution).not.toHaveBeenCalled();
  });
});

// ── Defense posts (real simulation) ─────────────────────────────────────────
// Land at x < 150, sea beyond. The invader holds y < 20 and borders the nation
// along y = 20.

describe("NationStructureBehavior defense posts (real simulation)", () => {
  function makeFrontGame(difficulty: Difficulty) {
    const width = 200;
    const height = 100;
    const grid: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) grid.push(x < 150 ? L : W);
    }
    const game = createGame({ width, height, grid }, { difficulty });
    game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    );
    game.addPlayer(
      new PlayerInfo("invader", PlayerType.Human, null, "invader_id"),
    );
    const nation = game.player("nation_id");
    const invader = game.player("invader_id");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.y(tile) < 20 ? invader : nation).conquer(tile);
    });
    nation.setTroops(10_000);
    nation.addGold(10_000_000n);
    game.endSpawnPhase();
    return { game, nation, invader };
  }

  function builtPostTiles(spy: { mock: { calls: any[][] } }): number[] {
    return spy.mock.calls
      .map((c) => c[0])
      .filter(
        (e): e is ConstructionExecution =>
          e instanceof ConstructionExecution &&
          e["constructionType"] === UnitType.DefensePost,
      )
      .map((e) => e["tile"]);
  }

  function distToLandOf(game: Game, tile: number, owner: Player): number {
    let best = Infinity;
    game.map().forEachTile((t) => {
      if (game.owner(t) !== owner) return;
      best = Math.min(best, Math.sqrt(game.euclideanDistSquared(tile, t)));
    });
    return best;
  }

  it("builds the post at the beachhead, not on the quiet land border", () => {
    const { game, nation, invader } = makeFrontGame(Difficulty.Hard);
    // What TransportShipExecution does on landing.
    const landing = game.ref(149, 85);
    invader.conquer(landing);
    game.addExecution(
      new AttackExecution(50_000, invader, nation.id(), landing, false),
    );
    for (let i = 0; i < 5; i++) game.executeNextTick();
    expect(nation.incomingAttacks()).toHaveLength(1);

    const behavior = makeBehavior(game, nation, new PseudoRandom(42));
    const spy = vi.spyOn(game, "addExecution");
    expect((behavior as any).tryBuildDefensePost()).toBe(true);
    const [tile] = builtPostTiles(spy);
    const distToLanding = Math.sqrt(game.euclideanDistSquared(tile, landing));
    expect(distToLanding).toBeLessThan(game.y(tile) - 20);
  });

  it.each([
    { difficulty: Difficulty.Medium, attack: 50_000, min: 20, max: 35 },
    { difficulty: Difficulty.Hard, attack: 5_000, min: 25, max: 40 },
    { difficulty: Difficulty.Hard, attack: 50_000, min: 40, max: 55 },
  ])(
    "$difficulty keeps the post $min-$max tiles behind a $attack-troop attack",
    ({ difficulty, attack, min, max }) => {
      const { game, nation, invader } = makeFrontGame(difficulty);
      game.addExecution(
        new AttackExecution(attack, invader, nation.id(), null, false),
      );
      for (let i = 0; i < 5; i++) game.executeNextTick();
      expect(nation.incomingAttacks()).toHaveLength(1);

      const random = new PseudoRandom(42);
      vi.spyOn(random, "chance").mockReturnValue(true);
      const behavior = makeBehavior(game, nation, random);
      const spy = vi.spyOn(game, "addExecution");
      expect((behavior as any).tryBuildDefensePost()).toBe(true);
      const [tile] = builtPostTiles(spy);
      const dist = distToLandOf(game, tile, invader);
      expect(dist).toBeGreaterThanOrEqual(min);
      expect(dist).toBeLessThanOrEqual(max + 1);
    },
  );

  const CITY_TILES = [
    [60, 90],
    [120, 90],
    [60, 60],
    [120, 60],
  ];

  function withCities(game: Game, nation: Player, count: number) {
    for (const [x, y] of CITY_TILES.slice(0, count)) {
      nation.buildUnit(UnitType.City, game.ref(x, y), {});
    }
  }

  function proactive(game: Game, nation: Player): boolean {
    const behavior = makeBehavior(game, nation, new PseudoRandom(42));
    return (behavior as any).maybeBuildProactiveDefensePost();
  }

  it("Hard fortifies the border with a stronger neighbor that recently attacked it", () => {
    const { game, nation, invader } = makeFrontGame(Difficulty.Hard);
    withCities(game, nation, 4);
    invader.setTroops(20_000);
    nation.updateRelation(invader, -100);

    const spy = vi.spyOn(game, "addExecution");
    expect(proactive(game, nation)).toBe(true);
    const [tile] = builtPostTiles(spy);
    const dist = distToLandOf(game, tile, invader);
    expect(dist).toBeGreaterThanOrEqual(15);
    expect(dist).toBeLessThanOrEqual(31);

    // One post per threatening neighbor.
    for (let i = 0; i < 2; i++) game.executeNextTick();
    expect(nation.units(UnitType.DefensePost)).toHaveLength(1);
    expect(proactive(game, nation)).toBe(false);
  });

  it("Medium never fortifies a border before an attack", () => {
    const { game, nation, invader } = makeFrontGame(Difficulty.Medium);
    withCities(game, nation, 4);
    invader.setTroops(20_000);
    nation.updateRelation(invader, -100);
    expect(proactive(game, nation)).toBe(false);
  });

  it.each([
    { difficulty: Difficulty.Hard, hostile: true, troops: 6_000, built: false },
    {
      difficulty: Difficulty.Impossible,
      hostile: true,
      troops: 6_000,
      built: true,
    },
    {
      difficulty: Difficulty.Impossible,
      hostile: true,
      troops: 4_000,
      built: false,
    },
    {
      difficulty: Difficulty.Impossible,
      hostile: false,
      troops: 50_000,
      built: false,
    },
  ])(
    "$difficulty vs a $troops-troop neighbor (hostile: $hostile) builds: $built",
    ({ difficulty, hostile, troops, built }) => {
      const { game, nation, invader } = makeFrontGame(difficulty);
      withCities(game, nation, 4);
      invader.setTroops(troops);
      if (hostile) nation.updateRelation(invader, -100);
      expect(proactive(game, nation)).toBe(built);
    },
  );

  it("stops fortifying at half a post per city", () => {
    const { game, nation, invader } = makeFrontGame(Difficulty.Hard);
    game.addPlayer(
      new PlayerInfo("invader2", PlayerType.Human, null, "invader2_id"),
    );
    const invader2 = game.player("invader2_id");
    game.map().forEachTile((tile) => {
      if (game.owner(tile) === nation && game.x(tile) < 20) {
        invader2.conquer(tile);
      }
    });
    for (const p of [invader, invader2]) {
      p.setTroops(20_000);
      nation.updateRelation(p, -100);
    }
    withCities(game, nation, 2);

    expect(proactive(game, nation)).toBe(true);
    for (let i = 0; i < 2; i++) game.executeNextTick();
    expect(proactive(game, nation)).toBe(false);

    withCities(game, nation, 4);
    expect(proactive(game, nation)).toBe(true);
  });

  it("does not fortify borders before owning two cities", () => {
    const { game, nation, invader } = makeFrontGame(Difficulty.Impossible);
    withCities(game, nation, 1);
    invader.setTroops(20_000);
    nation.updateRelation(invader, -100);
    expect(proactive(game, nation)).toBe(false);
  });
});

// ── defensePostNeeded ────────────────────────────────────────────────────────

describe("NationStructureBehavior.defensePostNeeded", () => {
  function makeAttack(troops: number, sourceTile: number | null = null): any {
    return {
      troops: () => troops,
      sourceTile: () => sourceTile,
      attacker: () => ({ id: () => "a" }),
    };
  }

  function makeGame(difficulty: Difficulty): any {
    return {
      config: () => ({ gameConfig: () => ({ difficulty }) }),
    };
  }

  function makePlayer(troops: number, attacks: any[]): any {
    return {
      troops: () => troops,
      incomingAttacks: () => attacks,
    };
  }

  function call(
    difficulty: Difficulty,
    troops: number,
    attacks: any[],
  ): boolean {
    const behavior = makeBehavior(
      makeGame(difficulty),
      makePlayer(troops, attacks),
    );
    return (behavior as any).defensePostNeeded();
  }

  it("returns false on Easy", () => {
    expect(call(Difficulty.Easy, 1000, [makeAttack(1000)])).toBe(false);
  });

  it("returns false when there are no incoming attacks", () => {
    expect(call(Difficulty.Hard, 1000, [])).toBe(false);
  });

  it("returns false when own troops are zero", () => {
    expect(call(Difficulty.Hard, 0, [makeAttack(1000)])).toBe(false);
  });

  it("returns false when ratio is below threshold (0.35)", () => {
    expect(call(Difficulty.Hard, 1000, [makeAttack(349)])).toBe(false);
  });

  it("returns true when ratio is exactly at threshold (0.35)", () => {
    expect(call(Difficulty.Hard, 1000, [makeAttack(350)])).toBe(true);
  });

  it("returns true when ratio is above threshold", () => {
    expect(call(Difficulty.Medium, 1000, [makeAttack(700)])).toBe(true);
  });

  it("counts boat attacks (sourceTile != null)", () => {
    expect(call(Difficulty.Hard, 1000, [makeAttack(5000, 999)])).toBe(true);
  });

  it("sums troops across multiple land attacks for the ratio", () => {
    expect(
      call(Difficulty.Hard, 1000, [makeAttack(200), makeAttack(200)]),
    ).toBe(true);
  });
});

// ── findDefensePostTile ──────────────────────────────────────────────────────

describe("NationStructureBehavior.findDefensePostTile", () => {
  // 1D layout: tile ref = x. Post range 30 → spread range 45.
  function makeEnv(existingPostTiles: number[]) {
    const player: any = {
      units: () => existingPostTiles.map(makeUnit),
      canBuild: () => true,
    };
    const game: any = {
      config: () => ({ defensePostRange: () => 30 }),
      x: (t: number) => t,
      y: () => 0,
      isValidCoord: () => true,
      ref: (x: number) => x,
      owner: () => player,
      euclideanDistSquared: (a: number, b: number) => (a - b) ** 2,
    };
    return { player, game };
  }

  it("returns null when no front tiles are supplied", () => {
    const { player, game } = makeEnv([]);
    const behavior = makeBehavior(game, player);
    expect((behavior as any).findDefensePostTile([], 20, 35)).toBeNull();
  });

  it("returns null when the whole front is already covered by a defense post", () => {
    const { player, game } = makeEnv([1000]);
    const behavior = makeBehavior(game, player);
    expect(
      (behavior as any).findDefensePostTile([990, 1010, 1040], 20, 35),
    ).toBeNull();
  });

  it("skips candidates too close to the front or near an existing post", () => {
    const { player, game } = makeEnv([1000]);
    const random = new PseudoRandom(0);
    vi.spyOn(random, "randElement").mockImplementation((arr: any[]) => arr[0]);
    // Anchor 1100 is free. 1110 is too close to the front, 1060 is 40 from the
    // post, 1075 is 25 from the front and 75 from the post.
    vi.spyOn(random, "nextInt")
      .mockReturnValueOnce(1110)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1060)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1075)
      .mockReturnValueOnce(0);
    const behavior = makeBehavior(game, player, random);
    expect((behavior as any).findDefensePostTile([1100], 20, 35)).toBe(1075);
  });

  it("skips candidates too far behind the front", () => {
    const { player, game } = makeEnv([]);
    const random = new PseudoRandom(0);
    vi.spyOn(random, "randElement").mockImplementation((arr: any[]) => arr[0]);
    vi.spyOn(random, "nextInt")
      .mockReturnValueOnce(60)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(0);
    const behavior = makeBehavior(game, player, random);
    expect((behavior as any).findDefensePostTile([0], 20, 35)).toBe(30);
  });

  it("skips candidates where canBuild fails", () => {
    const { player, game } = makeEnv([]);
    player.canBuild = (_type: UnitType, t: number) => t !== 25;
    const random = new PseudoRandom(0);
    vi.spyOn(random, "randElement").mockImplementation((arr: any[]) => arr[0]);
    vi.spyOn(random, "nextInt")
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(28)
      .mockReturnValueOnce(0);
    const behavior = makeBehavior(game, player, random);
    expect((behavior as any).findDefensePostTile([0], 20, 35)).toBe(28);
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
      neighbors4: (tile: number, out: number[]) => {
        const ns = neighborsFn(tile);
        for (let i = 0; i < ns.length; i++) {
          out[i] = ns[i];
        }
        return ns.length;
      },
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
    return { attacker: () => attacker, sourceTile: () => null };
  }

  function makeBoatAttack(attacker: any, border: number[]): any {
    return {
      attacker: () => attacker,
      sourceTile: () => 999,
      borderTiles: () => new Set(border),
    };
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

  // Our border: 10 touches the attacker's land (100), 20 touches its beachhead (200).
  function makeBoatScenario(attacker: any) {
    const player = makePlayer([10, 20]);
    const game = makeGame(
      (tile) => (tile === 10 ? [100] : tile === 20 ? [200] : []),
      (tile) =>
        tile === 100 || tile === 200
          ? attacker
          : tile === 10 || tile === 20
            ? player
            : null,
    );
    return makeBehavior(game, player);
  }

  it("uses only the landing frontier when the boat attacker isn't attacking by land", () => {
    const attacker = { id: () => "atk" };
    const behavior = makeBoatScenario(attacker);
    // 30 is no longer ours, so it is dropped.
    expect(
      (behavior as any).getAttackFrontTiles([
        makeBoatAttack(attacker, [20, 30]),
      ]),
    ).toEqual([20]);
  });

  it("does not add a landing twice when its attacker also attacks by land", () => {
    const attacker = { id: () => "atk" };
    const behavior = makeBoatScenario(attacker);
    expect(
      (behavior as any).getAttackFrontTiles([
        makeAttack(attacker),
        makeBoatAttack(attacker, [20]),
      ]),
    ).toEqual([10, 20]);
  });
});

// ── countDefensePostsNearFront ───────────────────────────────────────────────

describe("NationStructureBehavior.countDefensePostsNearFront", () => {
  const RANGE = 45;
  const threshold = RANGE ** 2;

  function makeCountGame(distFn: (a: number, b: number) => number): any {
    return {
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
    return (behavior as any).countDefensePostsNearFront(frontTiles, RANGE);
  }

  it("returns 0 when there are no defense posts", () => {
    expect(count([], [1], () => threshold - 1)).toBe(0);
  });

  it("returns 0 when front tiles list is empty", () => {
    expect(count([1, 2], [], () => 0)).toBe(0);
  });

  it("counts posts within range of any front tile", () => {
    expect(count([10, 20], [1], () => threshold - 1)).toBe(2);
  });

  it("does not count posts out of range", () => {
    expect(count([10, 20], [1], () => threshold + 1)).toBe(0);
  });

  it("counts a post only once even if near multiple front tiles", () => {
    expect(count([10], [1, 2], () => threshold - 1)).toBe(1);
  });

  it("sums posts near different sections of the front", () => {
    expect(count([10, 20], [1, 2], () => threshold - 1)).toBe(2);
  });
});

// ── doHandleStructures — crowded-map first-structure exception ──────────────
// Regression tests for a bug where the "first structure is a port/factory on
// crowded maps" exception was gated on unitsOwned(City) === 0. Since that
// branch never builds a city itself, unitsOwned(City) stayed 0 forever, so
// the exception kept re-firing on every call and the nation could never
// reach the actual city-building code. It now uses its own one-shot flag,
// consumed only on success, so it neither loops forever nor loses its only
// chance to the unrelated high-gold SAM-first branch.

describe("NationStructureBehavior.doHandleStructures — crowded-map exception", () => {
  function makeCrowdedGame(opts: { difficulty?: Difficulty } = {}): any {
    return {
      config: () => ({
        isUnitDisabled: () => false,
        gameConfig: () => ({
          difficulty: opts.difficulty ?? Difficulty.Medium,
        }),
        startingGold: () => 0n,
      }),
      sharedWaterComponents: () => null, // landlocked -> Factory preferred
      nations: () => Array(400).fill({}),
      numLandTiles: () => 1_000_000, // 400 / 1_000_000 > 1/7500 -> high density
    };
  }

  function makeCrowdedPlayer(): any {
    return {
      unitsOwned: () => 0, // never owns a city
      numTilesOwned: () => 100_000,
      info: () => ({}),
    };
  }

  it("builds a Factory (not a City) on the very first structure decision", () => {
    const behavior = makeBehavior(makeCrowdedGame(), makeCrowdedPlayer());
    const spy = vi
      .spyOn(behavior as any, "maybeSpawnStructure")
      .mockReturnValue(true);

    expect((behavior as any).doHandleStructures()).toBe(true);
    expect(spy).toHaveBeenCalledWith(UnitType.Factory);
    expect(spy).not.toHaveBeenCalledWith(UnitType.City);
  });

  it("does not re-fire once it has already succeeded, even though the player still owns no cities", () => {
    const behavior = makeBehavior(makeCrowdedGame(), makeCrowdedPlayer());
    (behavior as any).builtCrowdedMapFirstStructure = true; // already succeeded once
    const spy = vi
      .spyOn(behavior as any, "maybeSpawnStructure")
      .mockReturnValue(true);

    expect((behavior as any).doHandleStructures()).toBe(true);
    expect(spy).toHaveBeenCalledWith(UnitType.City);
    expect(spy).not.toHaveBeenCalledWith(UnitType.Factory);
  });

  it("still gets its chance after the high-gold SAM-first branch has already placed the nation's literal first structure", () => {
    const game = makeCrowdedGame({ difficulty: Difficulty.Impossible });
    game.config = () => ({
      isUnitDisabled: () => false,
      gameConfig: () => ({ difficulty: Difficulty.Impossible }),
      startingGold: () => 10_000_000n, // above HIGH_STARTING_GOLD_THRESHOLD
    });
    const behavior = makeBehavior(game, makeCrowdedPlayer());
    const spy = vi
      .spyOn(behavior as any, "maybeSpawnStructure")
      .mockReturnValue(true);

    // Structure #1: the unrelated high-gold SAM-first branch fires.
    expect((behavior as any).doHandleStructures()).toBe(true);
    expect(spy).toHaveBeenLastCalledWith(UnitType.SAMLauncher);
    expect((behavior as any).builtCrowdedMapFirstStructure).toBe(false);
    (behavior as any).placementsCount = 1; // what handleStructures() would do

    // Structure #2: the crowded-map branch must still fire here, not be
    // skipped just because placementsCount is no longer 0.
    expect((behavior as any).doHandleStructures()).toBe(true);
    expect(spy).toHaveBeenLastCalledWith(UnitType.Factory);
    expect((behavior as any).builtCrowdedMapFirstStructure).toBe(true);
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
