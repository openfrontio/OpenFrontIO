import {
  Difficulty,
  GameMode,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

// size x size with a lake in the middle half: `nation` owns the west coast, `other` the
// east coast, optionally with team spawn areas on either shore. When landlocked, `coast`
// owns the west shore and `nation` only the land behind it.
function setupCoast(
  config: {
    difficulty: Difficulty;
    gameMode?: GameMode;
    disabledUnits?: UnitType[];
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
  return { game, nation, coast, behavior, cities, built, upgraded };
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
      const { behavior, cities } = setupCoast({ difficulty, gameMode: ffa });
      cities(owned);
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
      const { game, nation, behavior } = setupCoast(
        {
          difficulty: Difficulty.Hard,
          gameMode: ffa,
          disabledUnits: [UnitType.City],
        },
        { size },
      );
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

  // Ports are due (cities disabled: one city per 2000 tiles), and nothing else is
  function withPort(
    difficulty: Difficulty,
    { shortCoast }: { shortCoast: boolean },
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
    nation.addGold(5_000_000n);
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
