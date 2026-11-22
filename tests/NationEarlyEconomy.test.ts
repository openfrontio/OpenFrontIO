import {
  Difficulty,
  GameMode,
  MAX_UPGRADE_AMOUNT,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import type { Game } from "@openfront/engine/game/Game";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

// size x size with a lake in the middle half: `nation` owns the west coast, `other` the
// east coast, optionally with team spawn areas on either shore. When landlocked, `coast`
// owns the west shore and `nation` only the land behind it.
function setupCoast(
  config: {
    difficulty: Difficulty;
    gameMode?: GameMode;
    disabledUnits?: UnitType[];
    startingGold?: number;
  },
  { spawnAreas = false, landlocked = false, size = 100 } = {},
) {
  const westEnd = size / 4;
  const grid: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      grid.push(x < westEnd || x >= size - westEnd ? L : W);
    }
  }
  const team = config.gameMode === GameMode.Team;
  const game = createGame(
    { width: size, height: size, grid },
    team ? { ...config, playerTeams: 2 } : config,
    spawnAreas
      ? {
          "2": [
            { x: 0, y: 0, width: size / 2, height: size },
            { x: size / 2, y: 0, width: size / 2, height: size },
          ],
        }
      : undefined,
  );
  const add = (id: string) =>
    game.addPlayer(new PlayerInfo(id, PlayerType.Nation, null, `${id}_id`));
  const nation = add("nation");
  const coast = add("coast");
  const other = add("other");
  game.map().forEachTile((tile) => {
    if (!game.map().isLand(tile)) return;
    const x = game.x(tile);
    if (x >= westEnd) other.conquer(tile);
    else if (landlocked && x >= 10) coast.conquer(tile);
    else nation.conquer(tile);
  });
  const cities = (n: number) => {
    for (let i = 0; i < n; i++) {
      nation.buildUnit(UnitType.City, game.ref(5, 10 + 20 * i), {});
    }
  };
  const behavior = new NationStructureBehavior(
    new PseudoRandom(7),
    game,
    nation,
  );
  const spy = vi.spyOn(game, "addExecution");
  const built = () =>
    spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e instanceof ConstructionExecution)
      .map((e) => e["constructionType"]);
  const upgraded = () =>
    spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e instanceof UpgradeStructureExecution)
      .map((e) => e["unitId"]);
  const builtTiles = (): number[] =>
    spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e instanceof ConstructionExecution)
      .map((e) => e["tile"]);
  // Lifetime income, which tells Hard & Impossible whether a save-up target is within reach
  const earned = (gold: bigint) => {
    nation.addGold(gold);
    nation.removeGold(gold);
  };
  return {
    game,
    nation,
    coast,
    behavior,
    cities,
    built,
    builtTiles,
    upgraded,
    earned,
  };
}

describe("Nation economy at the start", () => {
  const team = GameMode.Team;
  const ffa = GameMode.FFA;

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s builds a port before its first city when teams spawn apart",
    (difficulty) => {
      const { nation, behavior, built } = setupCoast(
        { difficulty, gameMode: team },
        { spawnAreas: true },
      );
      nation.addGold(200_000n);
      behavior.handleStructures();
      expect(built()).toEqual([UnitType.Port]);
    },
  );

  it("a landlocked nation builds a factory first there", () => {
    const { nation, behavior, built } = setupCoast(
      { difficulty: Difficulty.Hard, gameMode: team },
      { spawnAreas: true, landlocked: true },
    );
    nation.addGold(200_000n);
    behavior.handleStructures();
    expect(built()).toEqual([UnitType.Factory]);
  });

  it.each([
    ["Easy", Difficulty.Easy, team, true],
    ["without team spawn areas", Difficulty.Hard, team, false],
    ["FFA", Difficulty.Hard, ffa, false],
  ])("%s: builds a city first", (_, difficulty, gameMode, spawnAreas) => {
    const { nation, behavior, built } = setupCoast(
      { difficulty, gameMode },
      { spawnAreas },
    );
    nation.addGold(200_000n);
    behavior.handleStructures();
    expect(built()).toEqual([UnitType.City]);
  });

  // The second city costs 250k, and feels like 500k while saving up for nukes. In team
  // games one port per city is due, so the first port (125k) comes first.
  it.each([
    [Difficulty.Hard, ffa, [UnitType.City]],
    [Difficulty.Hard, team, [UnitType.Port]],
    [Difficulty.Easy, ffa, []],
  ])(
    "%s %s: with one city and 300k gold builds %j",
    (difficulty, gameMode, expected) => {
      const { nation, behavior, cities, built } = setupCoast({
        difficulty,
        gameMode,
      });
      cities(1);
      nation.addGold(300_000n);
      behavior.handleStructures();
      expect(built()).toEqual(expected);
    },
  );

  it("keeps the build order: with two cities the port comes before the third city", () => {
    const { nation, behavior, cities, built } = setupCoast({
      difficulty: Difficulty.Hard,
      gameMode: ffa,
    });
    cities(2);
    nation.addGold(1_000_000n);
    behavior.handleStructures();
    expect(built()).toEqual([UnitType.Port]);
  });

  // One port per city in team games (teammates are safe trade partners), 0.75 otherwise
  it.each([
    [Difficulty.Hard, team, true],
    [Difficulty.Hard, ffa, false],
    [Difficulty.Easy, team, false],
  ])(
    "%s %s: with four cities and three ports wants another port: %s",
    (difficulty, gameMode, expected) => {
      const { game, nation, behavior, cities } = setupCoast({
        difficulty,
        gameMode,
      });
      cities(4);
      for (const y of [10, 40, 70]) {
        nation.buildUnit(UnitType.Port, game.ref(24, y), {});
      }
      expect(behavior["shouldBuildStructure"](UnitType.Port, 4, true)).toBe(
        expected,
      );
    },
  );

  // Real city costs: 500k for the third, 1M from the fourth on. Harder nations start saving
  // later and inflate cities less while they do.
  it.each([
    [Difficulty.Medium, 2, 500_000n],
    [Difficulty.Medium, 4, 4_200_000n],
    [Difficulty.Hard, 3, 1_000_000n],
    [Difficulty.Hard, 4, 3_400_000n],
    [Difficulty.Impossible, 4, 1_000_000n],
    [Difficulty.Impossible, 5, 3_000_000n],
  ])(
    "%s: with %i cities the next one feels like %i",
    (difficulty, owned, perceived) => {
      const { behavior, cities, earned } = setupCoast({
        difficulty,
        gameMode: ffa,
      });
      cities(owned);
      earned(10_000_000n);
      expect(behavior["getPerceivedCost"](UnitType.City)).toBe(perceived);
    },
  );

  // A MIRV and a hydrogen bomb cost 30M: Hard saves for it within 5 minutes of income, Impossible
  // within 6, and income earned so far counts twice as the current rate
  it.each([
    [Difficulty.Medium, 4, 0n, 4_200_000n],
    [Difficulty.Hard, 4, 2_900_000n, 1_000_000n],
    [Difficulty.Hard, 4, 3_000_000n, 3_400_000n],
    [Difficulty.Impossible, 5, 2_400_000n, 1_000_000n],
    [Difficulty.Impossible, 5, 2_500_000n, 3_000_000n],
  ])(
    "%s: with %i cities and %i gold earned in the first minute, the next city feels like %i",
    (difficulty, owned, income, perceived) => {
      const { behavior, cities, earned } = setupCoast({
        difficulty,
        gameMode: ffa,
      });
      cities(owned);
      earned(income);
      expect(behavior["getPerceivedCost"](UnitType.City)).toBe(perceived);
    },
  );

  // Cities disabled: about one city per 2000 tiles. The second port costs 250k, 400k while saving
  it.each([
    [100, 2_500, 250_000n],
    [200, 10_000, 400_000n],
  ])(
    "without cities, on a %i-wide map (%i tiles) the second port feels like %i",
    (size, tiles, perceived) => {
      const { game, nation, behavior, earned } = setupCoast(
        {
          difficulty: Difficulty.Hard,
          gameMode: ffa,
          disabledUnits: [UnitType.City],
        },
        { size },
      );
      earned(10_000_000n);
      expect(nation.numTilesOwned()).toBe(tiles);
      nation.buildUnit(UnitType.Port, game.ref(size / 4 - 1, 10), {});
      expect(behavior["getPerceivedCost"](UnitType.Port)).toBe(perceived);
    },
  );
});

// 200x200, so these few structures stay below the density at which nations upgrade anyway
describe("Nation structure upgrades", () => {
  const ffa = GameMode.FFA;

  // A SAM at (10, 20) with the test config's range of 20, a city it covers, and `other`
  function withSam(difficulty: Difficulty, other: [UnitType, number, number]) {
    const setup = setupCoast({ difficulty, gameMode: ffa }, { size: 200 });
    const { game, nation } = setup;
    const sam = nation.buildUnit(UnitType.SAMLauncher, game.ref(10, 20), {});
    nation.buildUnit(UnitType.City, game.ref(10, 30), {});
    nation.buildUnit(other[0], game.ref(other[1], other[2]), {});
    nation.addGold(10_000_000n);
    return { ...setup, sam };
  }

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s upgrades its SAM instead of building one when it already covers every structure",
    (difficulty) => {
      const { behavior, sam, built, upgraded } = withSam(difficulty, [
        UnitType.Factory,
        20,
        25,
      ]);
      expect(behavior["maybeSpawnStructure"](UnitType.SAMLauncher)).toBe(true);
      expect(upgraded()).toEqual([sam.id()]);
      expect(built()).toEqual([]);
    },
  );

  it.each([
    ["a city is out of SAM range", Difficulty.Hard, UnitType.City, 10, 190],
    ["a port is out of SAM range", Difficulty.Hard, UnitType.Port, 49, 25],
    ["Easy", Difficulty.Easy, UnitType.Factory, 20, 25],
  ])("builds another SAM when %s", (_, difficulty, type, x, y) => {
    const { behavior, built, upgraded } = withSam(difficulty, [type, x, y]);
    expect(behavior["maybeSpawnStructure"](UnitType.SAMLauncher)).toBe(true);
    expect(built()).toEqual([UnitType.SAMLauncher]);
    expect(upgraded()).toEqual([]);
  });

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s builds another SAM when a city is out of SAM range, however dense its structures",
    (difficulty) => {
      const { game, nation, behavior, built, upgraded } = withSam(difficulty, [
        UnitType.City,
        10,
        190,
      ]);
      // Six more factories the SAM covers
      for (const x of [20, 25]) {
        for (const y of [22, 26, 30]) {
          nation.buildUnit(UnitType.Factory, game.ref(x, y), {});
        }
      }
      expect(behavior["getTotalStructureDensity"]()).toBeGreaterThan(1 / 1500);
      expect(behavior["maybeSpawnStructure"](UnitType.SAMLauncher)).toBe(true);
      expect(built()).toEqual([UnitType.SAMLauncher]);
      expect(upgraded()).toEqual([]);
    },
  );

  const within20 = (game: Game, a: number, b: number) =>
    game.euclideanDistSquared(a, b) <= 20 ** 2;

  it("Hard values a SAM spot by the structure no SAM covers over one by its biggest, covered city", () => {
    const { game, nation, behavior } = withSam(Difficulty.Hard, [
      UnitType.Factory,
      30,
      150,
    ]);
    const [city] = nation.units(UnitType.City);
    for (let i = 1; i < 50; i++) city.increaseLevel();
    const value = behavior["placement"]["samLauncherValue"](false);
    // 15 tiles from the factory vs 15 tiles from the city
    expect(value(game.ref(30, 135))).toBeGreaterThan(value(game.ref(10, 45)));
  });

  it("Impossible with plenty of spare gold puts a new SAM over land no SAM covers", () => {
    const { game, nation, behavior, sam, built, builtTiles } = withSam(
      Difficulty.Impossible,
      [UnitType.Factory, 20, 25],
    );
    nation.addGold(90_000_000n);
    expect(behavior["maybeSpawnStructure"](UnitType.SAMLauncher)).toBe(true);
    expect(built()).toEqual([UnitType.SAMLauncher]);
    expect(within20(game, builtTiles()[0], sam.tile())).toBe(false);
  });

  // A SAM guarding a level-10 city and a level-6 SAM guarding a level-100 city. 15M beyond the
  // 30M savings pays for five SAM levels at 3M.
  it.each([
    ["first raises a SAM below level 5 to 5", 1, 5, 6],
    ["then the one guarding the most", 5, 5, 11],
  ])("Impossible %s", (_, smallLevel, smallAfter, bigAfter) => {
    const { game, nation, behavior } = setupCoast(
      { difficulty: Difficulty.Impossible, gameMode: ffa },
      { size: 200 },
    );
    const guarded = (y: number, samLevel: number, cityLevel: number) => {
      const sam = nation.buildUnit(UnitType.SAMLauncher, game.ref(10, y), {});
      for (let i = 1; i < samLevel; i++) sam.increaseLevel();
      const city = nation.buildUnit(UnitType.City, game.ref(10, y + 10), {});
      for (let i = 1; i < cityLevel; i++) city.increaseLevel();
      return sam;
    };
    const small = guarded(20, smallLevel, 10);
    const big = guarded(120, 6, 100);
    nation.addGold(45_000_000n);
    game.endSpawnPhase();
    expect(behavior["maybeSpawnStructure"](UnitType.SAMLauncher)).toBe(true);
    game.executeNextTick();
    expect(small.level()).toBe(smallAfter);
    expect(big.level()).toBe(bigAfter);
  });

  // Ports are due (cities disabled: one city per 2000 tiles), and nothing else is. Without silos
  // the nation saves up for a SAM (1.5M).
  function withPort(
    difficulty: Difficulty,
    { shortCoast, gold = 5_000_000n }: { shortCoast: boolean; gold?: bigint },
  ) {
    const setup = setupCoast(
      {
        difficulty,
        gameMode: ffa,
        disabledUnits: [UnitType.City, UnitType.Factory, UnitType.MissileSilo],
      },
      { size: 200 },
    );
    const { game, nation, coast } = setup;
    if (shortCoast) {
      // Leave the nation 12 tiles of shore, all too close to its port for another one
      game.map().forEachTile((tile) => {
        if (
          game.owner(tile) === nation &&
          game.x(tile) >= 45 &&
          game.y(tile) >= 12
        ) {
          coast.conquer(tile);
        }
      });
    }
    const port = nation.buildUnit(UnitType.Port, game.ref(49, 5), {});
    nation.addGold(gold);
    return { ...setup, port };
  }

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s upgrades its port when the coast has no room for another",
    (difficulty) => {
      const { behavior, port, built, upgraded } = withPort(difficulty, {
        shortCoast: true,
      });
      expect(behavior.handleStructures()).toBe(true);
      expect(upgraded()).toEqual([port.id()]);
      expect(built()).toEqual([]);
    },
  );

  // The next port levels cost 250k, 500k, then 1M each. With four city equivalents the nation
  // wants three ports, so two more levels.
  it.each([
    ["what the gold beyond the 1.5M savings pays for", 2_000_000n, 1],
    ["what the port ratio asks for", 1_000_000_000n, 2],
  ])("upgrades its port by %s", (_, gold, levels) => {
    const { game, behavior, port } = withPort(Difficulty.Hard, {
      shortCoast: true,
      gold,
    });
    expect(behavior.handleStructures()).toBe(true);
    game.endSpawnPhase();
    game.executeNextTick();
    expect(port.level()).toBe(1 + levels);
  });

  // Two cities and a port leave nothing else due, and are dense enough to upgrade a city.
  // The nation saves up 30M for a MIRV and a hydrogen bomb.
  function withCities(difficulty: Difficulty) {
    const setup = setupCoast({ difficulty, gameMode: ffa });
    const { game, nation, cities } = setup;
    cities(2);
    nation.buildUnit(UnitType.Port, game.ref(24, 50), {});
    nation.addGold(1_000_000_000n);
    expect(setup.behavior.handleStructures()).toBe(true);
    game.endSpawnPhase();
    game.executeNextTick();
    const cityLevels = nation
      .units(UnitType.City)
      .reduce((sum, c) => sum + c.level(), 0);
    return { ...setup, cityLevels };
  }

  it.each([
    [Difficulty.Easy, 3],
    [Difficulty.Medium, 10],
    [Difficulty.Hard, MAX_UPGRADE_AMOUNT],
    [Difficulty.Impossible, MAX_UPGRADE_AMOUNT],
  ])("%s buys at most %i city levels at once", (difficulty, levels) => {
    expect(withCities(difficulty).cityLevels).toBe(2 + levels);
  });

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s spends the gold left after a full city upgrade on other structures",
    (difficulty) => {
      const { game, nation, behavior } = withCities(difficulty);
      expect(nation.gold()).toBeGreaterThan(900_000_000n);
      expect(behavior.handleStructures()).toBe(true);
      game.executeNextTick();
      // 52 city levels ask for 39 ports in FFA
      const [port] = nation.units(UnitType.Port);
      expect(port.level()).toBe(39);
    },
  );

  it("Easy does not", () => {
    const { behavior, built, upgraded } = withPort(Difficulty.Easy, {
      shortCoast: true,
    });
    expect(behavior.handleStructures()).toBe(false);
    expect(upgraded()).toEqual([]);
    expect(built()).toEqual([]);
  });

  it("builds a new port while the coast has room", () => {
    const { behavior, built, upgraded } = withPort(Difficulty.Hard, {
      shortCoast: false,
    });
    expect(behavior.handleStructures()).toBe(true);
    expect(built()).toEqual([UnitType.Port]);
    expect(upgraded()).toEqual([]);
  });
});

describe("Nation upgrades without SAM cover", () => {
  // A SAM still under construction at (10, 20) covers a city at (10, 30); nothing covers the
  // one at (10, size - 10). Both cities are at level 4.
  function cappedCities(
    difficulty: Difficulty,
    enemySilo: boolean,
    samsDisabled = false,
    size = 100,
  ) {
    const setup = setupCoast(
      {
        difficulty,
        gameMode: GameMode.FFA,
        disabledUnits: samsDisabled ? [UnitType.SAMLauncher] : [],
      },
      { size },
    );
    const { game, nation } = setup;
    if (!samsDisabled) {
      const sam = nation.buildUnit(UnitType.SAMLauncher, game.ref(10, 20), {});
      sam.setUnderConstruction(true);
    }
    for (const y of [30, size - 10]) {
      const city = nation.buildUnit(UnitType.City, game.ref(10, y), {});
      for (let l = 1; l < 4; l++) city.increaseLevel();
    }
    if (enemySilo) {
      game
        .player("other_id")
        .buildUnit(UnitType.MissileSilo, game.ref(size - 20, 50), {});
    }
    nation.addGold(10_000_000n);
    return setup;
  }

  it.each([
    [Difficulty.Impossible, true, false, [UnitType.SAMLauncher], 0],
    [Difficulty.Impossible, false, false, [], 1],
    [Difficulty.Hard, true, false, [], 1],
    [Difficulty.Impossible, true, true, [], 1],
  ])(
    "%s, enemy owns a silo: %s, SAMs disabled: %s, builds %j and upgrades %i cities",
    (difficulty, enemySilo, samsDisabled, built, upgrades) => {
      const setup = cappedCities(difficulty, enemySilo, samsDisabled);
      expect(setup.behavior["maybeSpawnStructure"](UnitType.City)).toBe(true);
      expect(setup.built()).toEqual(built);
      expect(setup.upgraded()).toHaveLength(upgrades);
    },
  );

  it("puts that SAM over the city nothing covers", () => {
    const { game, behavior, builtTiles } = cappedCities(
      Difficulty.Impossible,
      true,
    );
    behavior["maybeSpawnStructure"](UnitType.City);
    expect(
      game.euclideanDistSquared(builtTiles()[0], game.ref(10, 90)),
    ).toBeLessThanOrEqual(20 ** 2);
  });

  it("finds a spot for that SAM in a corner of a large territory", () => {
    const { game, nation, builtTiles } = cappedCities(
      Difficulty.Impossible,
      true,
      false,
      400,
    );
    for (let seed = 0; seed < 10; seed++) {
      const behavior = new NationStructureBehavior(
        new PseudoRandom(seed),
        game,
        nation,
      );
      expect(behavior["buildCoveringSam"]()).toBe(true);
    }
    for (const tile of builtTiles()) {
      expect(
        game.euclideanDistSquared(tile, game.ref(10, 390)),
      ).toBeLessThanOrEqual(20 ** 2);
    }
  });
});

describe("Nation first structures with a high starting gold", () => {
  const firstOfEach = [
    UnitType.MissileSilo,
    UnitType.SAMLauncher,
    UnitType.Port,
    UnitType.Factory,
    UnitType.City,
  ];

  it.each([
    [Difficulty.Impossible, 1_000_000_000, firstOfEach],
    [Difficulty.Hard, 25_000_000, firstOfEach],
    [Difficulty.Impossible, 5_000_000, [UnitType.SAMLauncher]],
    [Difficulty.Medium, 1_000_000_000, [UnitType.City]],
  ])(
    "%s starting with %i builds %j first, without upgrading",
    (difficulty, startingGold, first) => {
      const { game, behavior, built, upgraded } = setupCoast(
        { difficulty, gameMode: GameMode.FFA, startingGold },
        { size: 200 },
      );
      game.endSpawnPhase();
      for (let i = 0; i < first.length; i++) {
        behavior.handleStructures();
        // The first tick inits the construction, the second places the structure
        game.executeNextTick();
        game.executeNextTick();
      }
      expect(built()).toEqual(first);
      expect(upgraded()).toEqual([]);
    },
  );
});

describe("Nation nuke reserve from a high starting gold", () => {
  function richNation(difficulty: Difficulty, nukes = 0, seconds = 600) {
    const setup = setupCoast(
      { difficulty, gameMode: GameMode.FFA, startingGold: 1_000_000_000 },
      { size: 200 },
    );
    const { game, nation, cities, behavior } = setup;
    cities(2);
    for (let i = 0; i < nukes; i++) {
      nation.buildUnit(UnitType.HydrogenBomb, game.ref(5, 5), {
        targetTile: game.ref(150, 5),
        trajectory: [],
      });
    }
    game.endSpawnPhase();
    vi.spyOn(game, "elapsedGameSeconds").mockReturnValue(seconds);
    const spendAll = () => {
      for (let i = 0; i < 200; i++) {
        behavior.handleStructures();
        game.executeNextTick();
      }
    };
    return { ...setup, spendAll };
  }

  // On top of the 30M saved for a MIRV and a hydrogen bomb
  it.each([
    [Difficulty.Hard, 0, 60_000_000n],
    [Difficulty.Impossible, 0, 100_000_000n],
    [Difficulty.Impossible, 10, 50_000_000n],
  ])(
    "%s with %i hydrogen bombs bought keeps %i for nukes",
    (difficulty, nukes, reserve) => {
      const { nation, spendAll } = richNation(difficulty, nukes);
      spendAll();
      expect(nation.gold()).toBeGreaterThanOrEqual(reserve);
      expect(nation.gold()).toBeLessThan(reserve + 31_000_000n);
    },
  );

  // Hard & Impossible get the first 10M at once, the rest over four minutes
  it.each([
    [30, 866_250_000n],
    [180, 247_500_000n],
  ])("Impossible after %is still keeps %i", (seconds, kept) => {
    const { nation, spendAll } = richNation(Difficulty.Impossible, 0, seconds);
    spendAll();
    expect(nation.gold()).toBeGreaterThanOrEqual(kept);
    expect(nation.gold()).toBeLessThan(kept + 31_000_000n);
  });

  // Every MIRV launched, by anyone, raises the price of the next
  it("Impossible takes a MIRV it bought off its reserve at the lowest MIRV price", () => {
    const { game, nation, behavior } = richNation(Difficulty.Impossible);
    nation.buildUnit(UnitType.MIRV, game.ref(5, 5), {
      targetTile: game.ref(150, 5),
    });
    game.recordMirvLaunch();
    game.recordMirvLaunch();
    expect(behavior["nukeReserve"]()).toBe(100_000_000n - 25_000_000n);
  });

  it.each([
    [Difficulty.Easy, 3],
    [Difficulty.Impossible, 7],
  ])("%s wants up to %i missile silo levels", (difficulty, levels) => {
    const { behavior } = richNation(difficulty);
    expect(behavior["levelsDue"](UnitType.MissileSilo, 100, true)).toBe(levels);
  });
});

// After first saving up a MIRV and a hydrogen bomb (30M), structures pause every other 15s
describe("Nation structure pauses after saving up", () => {
  it.each([
    [40_000_000n, true],
    [60_000_000n, false],
  ])("with %i gold, pauses: %s", (gold, paused) => {
    const { game, nation, behavior } = setupCoast({
      difficulty: Difficulty.Hard,
      gameMode: GameMode.FFA,
    });
    nation.addGold(gold);
    expect(behavior["isInPostSaveUpBlockedPhase"]()).toBe(false);
    behavior["_postSaveUpStartTick"] = game.ticks() - 150;
    expect(behavior["isInPostSaveUpBlockedPhase"]()).toBe(paused);
  });
});
