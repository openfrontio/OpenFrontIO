import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import {
  Difficulty,
  GameMode,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

// 100x100 with a 50-tile lake: `nation` owns the west coast, `other` the east coast,
// optionally with team spawn areas on either shore. When landlocked, `coast` owns the
// west shore and `nation` only the land behind it.
function setupCoast(
  config: { difficulty: Difficulty; gameMode?: GameMode },
  { spawnAreas = false, landlocked = false } = {},
) {
  const size = 100;
  const westEnd = 25;
  const grid: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      grid.push(x < westEnd || x >= size - 25 ? L : W);
    }
  }
  const team = config.gameMode === GameMode.Team;
  const game = createGame(
    { width: size, height: size, grid },
    team ? { ...config, playerTeams: 2 } : config,
    spawnAreas
      ? {
          "2": [
            { x: 0, y: 0, width: 50, height: size },
            { x: 50, y: 0, width: 50, height: size },
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
  return { nation, behavior, cities, built };
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

  // The second city costs 250k, and feels like 500k while saving up for nukes
  it.each([
    [Difficulty.Hard, ffa, [UnitType.City]],
    [Difficulty.Hard, team, [UnitType.City]],
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

  // Real city costs: 500k for the third, 1M for the fourth (inflated 4x with three owned)
  it.each([
    [2, 500_000n],
    [3, 4_000_000n],
  ])("with %i cities the next one feels like %i", (owned, perceived) => {
    const { behavior, cities } = setupCoast({
      difficulty: Difficulty.Hard,
      gameMode: ffa,
    });
    cities(owned);
    expect(behavior["getPerceivedCost"](UnitType.City)).toBe(perceived);
  });
});
