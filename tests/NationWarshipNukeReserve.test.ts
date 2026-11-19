import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

// 60x10: `nation` owns the land at x < 5, `navy` the land at x >= 55, open water between
describe("Nation warships keep gold for hydrogen bombs when atom bombs are disabled", () => {
  function setupSea(disabledUnits: UnitType[], silo: boolean) {
    const width = 60;
    const height = 10;
    const grid: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) grid.push(x < 5 || x >= 55 ? L : W);
    }
    const game = createGame(
      { width, height, grid },
      { difficulty: Difficulty.Impossible, disabledUnits },
    );
    game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    );
    game.addPlayer(new PlayerInfo("navy", PlayerType.Nation, null, "navy_id"));
    const nation = game.player("nation_id");
    const navy = game.player("navy_id");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.x(tile) < 5 ? nation : navy).conquer(tile);
    });
    nation.buildUnit(UnitType.Port, game.ref(4, 5), {});
    if (silo) nation.buildUnit(UnitType.MissileSilo, game.ref(1, 5), {});

    const random = new PseudoRandom(42);
    const warships = new NationWarshipBehavior(
      random,
      game,
      nation,
      new NationEmojiBehavior(random, game, nation),
    );
    const spy = vi.spyOn(game, "addExecution");
    const ordered = () =>
      spy.mock.calls
        .map((c) => c[0])
        .filter(
          (e) =>
            e instanceof ConstructionExecution &&
            e["constructionType"] === UnitType.Warship,
        ).length;
    const setGold = (gold: bigint) => {
      nation.removeGold(nation.gold());
      nation.addGold(gold);
    };
    const price = (type: UnitType, extra = 0) =>
      game.unitInfo(type).cost(game, nation, extra);
    const sinkBoats = () => {
      for (let i = 0; i < 5; i++) {
        const boat = nation.buildUnit(
          UnitType.TransportShip,
          game.ref(20 + i, 5),
          { troops: 100 },
        );
        warships.trackShipsAndRetaliate();
        boat.delete(false, navy);
        warships.trackShipsAndRetaliate();
      }
    };
    return { game, navy, warships, ordered, setGold, price, sinkBoats };
  }

  it.each([
    [
      "with atom bombs disabled, a silo owner keeps it from a sea-lane squad",
      [UnitType.AtomBomb],
      true,
      true,
    ],
    ["without a silo, it spends it", [UnitType.AtomBomb], false, false],
    ["with atom bombs enabled, it spends it", [], true, false],
  ])("%s", (_, disabledUnits, silo, reserves) => {
    const { game, navy, warships, ordered, setGold, price } = setupSea(
      disabledUnits,
      silo,
    );
    const water = game.ref(30, 5);
    const blocker = navy.buildUnit(UnitType.Warship, water, {
      patrolTile: water,
    });
    // Impossible sends one ship more than the blocking fleet
    const needed =
      price(UnitType.Warship) +
      price(UnitType.Warship, 1) +
      (reserves ? price(UnitType.HydrogenBomb) : 0n);
    setGold(needed - 1n);
    warships.clearSeaLane(blocker);
    expect(ordered()).toBe(0);
    setGold(needed);
    warships.clearSeaLane(blocker);
    expect(ordered()).toBe(2);
  });

  it("keeps it when avenging sunk boats, unlike with atom bombs enabled", () => {
    const disabled = setupSea([UnitType.AtomBomb], true);
    disabled.setGold(disabled.price(UnitType.HydrogenBomb));
    disabled.sinkBoats();
    expect(disabled.ordered()).toBe(0);

    const enabled = setupSea([], true);
    enabled.setGold(enabled.price(UnitType.HydrogenBomb));
    enabled.sinkBoats();
    expect(enabled.ordered()).toBeGreaterThan(0);
  });

  it("spends it to stop an invasion", () => {
    const { game, navy, warships, ordered, setGold, price } = setupSea(
      [UnitType.AtomBomb],
      true,
    );
    setGold(price(UnitType.HydrogenBomb));
    for (let y = 1; y <= 5; y++) {
      navy.buildUnit(UnitType.TransportShip, game.ref(50, y), {
        troops: 100,
        targetTile: game.ref(2, 5),
      });
    }
    for (let i = 0; i < 5; i++) warships.trackShipsAndRetaliate();
    expect(ordered()).toBeGreaterThan(0);
  });
});
