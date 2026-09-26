import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { createGame, L, W } from "./core/pathfinding/_fixtures";
import { setup } from "./util/Setup";

// ocean_and_land: land at x <= 7, open water, and a small island at x >= 14.
describe("Nation boats and hostile warships", () => {
  async function setupBoats(difficulty: Difficulty) {
    const game = await setup("ocean_and_land", { difficulty }, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      new PlayerInfo("island", PlayerType.Nation, null, "island_id"),
      new PlayerInfo("navy", PlayerType.Human, null, "navy_id"),
    ]);
    const nation = game.player("nation_id");
    const island = game.player("island_id");
    const navy = game.player("navy_id");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.x(tile) <= 7 ? nation : island).conquer(tile);
    });
    nation.setTroops(100_000);
    island.setTroops(10_000);

    const random = new PseudoRandom(42);
    const emoji = new NationEmojiBehavior(random, game, nation);
    const alliance = new NationAllianceBehavior(random, game, nation, emoji);
    const warships = new NationWarshipBehavior(random, game, nation, emoji);
    const behavior = new AiAttackBehavior(
      random,
      game,
      nation,
      0, // triggerRatio
      0, // reserveRatio
      0, // expandRatio
      alliance,
      emoji,
      warships,
    );
    return { game, nation, island, navy, behavior };
  }

  function spyExecutions(game: Game) {
    return vi.spyOn(game, "addExecution");
  }

  function boatsSent(spy: { mock: { calls: any[][] } }) {
    return spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e instanceof TransportShipExecution);
  }

  function warshipsOrdered(spy: { mock: { calls: any[][] } }, owner: Player) {
    return spy.mock.calls
      .map((c) => c[0])
      .filter(
        (e) =>
          e instanceof ConstructionExecution &&
          e["constructionType"] === UnitType.Warship &&
          e["player"] === owner,
      );
  }

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s: sends a boat over open water",
    async (difficulty) => {
      const { game, island, behavior } = await setupBoats(difficulty);
      const spy = spyExecutions(game);
      expect(behavior.sendAttack(island)).toBe(true);
      expect(boatsSent(spy)).toHaveLength(1);
    },
  );

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s: holds the boat when a hostile warship covers the route",
    async (difficulty) => {
      const { game, island, navy, behavior } = await setupBoats(difficulty);
      const water = game.ref(11, 12);
      navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
      const spy = spyExecutions(game);
      expect(behavior.sendAttack(island)).toBe(false);
      expect(boatsSent(spy)).toHaveLength(0);
    },
  );

  it("Easy: sends the boat anyway", async () => {
    const { game, island, navy, behavior } = await setupBoats(Difficulty.Easy);
    const water = game.ref(11, 12);
    navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
    const spy = spyExecutions(game);
    expect(behavior.sendAttack(island)).toBe(true);
    expect(boatsSent(spy)).toHaveLength(1);
  });

  it("ignores warships of allies", async () => {
    const { game, nation, island, navy, behavior } = await setupBoats(
      Difficulty.Impossible,
    );
    navy.createAllianceRequest(nation)?.accept();
    expect(navy.isAlliedWith(nation)).toBe(true);
    const water = game.ref(11, 12);
    navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
    const spy = spyExecutions(game);
    expect(behavior.sendAttack(island)).toBe(true);
    expect(boatsSent(spy)).toHaveLength(1);
  });

  it.each([
    [Difficulty.Impossible, 2],
    [Difficulty.Hard, 1],
    [Difficulty.Medium, 0],
    [Difficulty.Easy, 0],
  ])(
    "%s: blocked boat orders %i warships against the blocker at once",
    async (difficulty, expected) => {
      const { game, nation, navy, behavior } = await setupBoats(difficulty);
      nation.buildUnit(UnitType.Port, game.ref(7, 8), {});
      nation.addGold(10_000_000n);
      const water = game.ref(11, 12);
      navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
      const spy = spyExecutions(game);
      behavior.maybeAttack();
      expect(boatsSent(spy)).toHaveLength(0);
      expect(warshipsOrdered(spy, nation)).toHaveLength(expected);
    },
  );

  it.each([
    [0n, 0],
    [10_000_000n, 4],
  ])(
    "Impossible with %i gold against 3 guards orders %i warships (the whole squad or none)",
    async (gold, expected) => {
      const { game, nation, navy, behavior } = await setupBoats(
        Difficulty.Impossible,
      );
      nation.buildUnit(UnitType.Port, game.ref(7, 8), {});
      nation.addGold(gold);
      for (let i = 0; i < 3; i++) {
        const water = game.ref(11 + (i % 2), 12 + Math.floor(i / 2));
        navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
      }
      const spy = spyExecutions(game);
      behavior.maybeAttack();
      expect(boatsSent(spy)).toHaveLength(0);
      expect(warshipsOrdered(spy, nation)).toHaveLength(expected);
    },
  );

  it("Impossible without a land front boats the juiciest enemy across the water", async () => {
    const { game, nation, island, behavior } = await setupBoats(
      Difficulty.Impossible,
    );
    // Split the island: `island` keeps the two tiles nearest to us, `rich`
    // gets the other four and a city
    game.addPlayer(new PlayerInfo("rich", PlayerType.Nation, null, "rich_id"));
    const rich = game.player("rich_id");
    for (const [x, y] of [
      [14, 6],
      [15, 6],
      [15, 7],
      [15, 8],
    ]) {
      rich.conquer(game.ref(x, y));
    }
    rich.buildUnit(UnitType.City, game.ref(15, 7), {});
    // Both weaker than us, neither "very weak" (below 15% of its max troops)
    island.setTroops(Math.floor(game.config().maxTroops(island) * 0.5));
    rich.setTroops(Math.floor(game.config().maxTroops(rich) * 0.25));
    nation.setTroops(game.config().maxTroops(nation));

    const spy = spyExecutions(game);
    behavior.maybeAttack();
    const targets = boatsSent(spy).map((e) => game.owner(e["ref"]));
    expect(targets).toContain(rich);
  });

  it("does not build a retaliation warship where one of ours already patrols", async () => {
    const { game, nation, navy } = await setupBoats(Difficulty.Impossible);
    nation.buildUnit(UnitType.Port, game.ref(7, 8), {});
    nation.addGold(10_000_000n);
    const warships = new NationWarshipBehavior(
      new PseudoRandom(42),
      game,
      nation,
      new NationEmojiBehavior(new PseudoRandom(42), game, nation),
    );
    const sinkBoat = () => {
      const boat = nation.buildUnit(UnitType.TransportShip, game.ref(11, 4), {
        troops: 100,
      });
      warships.trackShipsAndRetaliate();
      boat.delete(false, navy);
      const spy = spyExecutions(game);
      warships.trackShipsAndRetaliate();
      const ordered = warshipsOrdered(spy, nation).length;
      spy.mockRestore();
      return ordered;
    };

    // Retaliation is a dice roll, so sink a few boats each time
    const sinkBoats = () =>
      Array.from({ length: 5 }, sinkBoat).reduce((a, b) => a + b, 0);

    expect(sinkBoats()).toBeGreaterThan(0);
    const near = game.ref(10, 4);
    nation.buildUnit(UnitType.Warship, near, { patrolTile: near });
    expect(sinkBoats()).toBe(0);
  });

  it.each([
    [Difficulty.Impossible, 1],
    [Difficulty.Hard, 0],
  ])(
    "%s: with one warship already on the blocker, orders %i more",
    async (difficulty, expected) => {
      const { game, nation, navy, behavior } = await setupBoats(difficulty);
      nation.buildUnit(UnitType.Port, game.ref(7, 8), {});
      nation.addGold(10_000_000n);
      const water = game.ref(11, 12);
      navy.buildUnit(UnitType.Warship, water, { patrolTile: water });
      const near = game.ref(10, 10);
      nation.buildUnit(UnitType.Warship, near, { patrolTile: near });
      const spy = spyExecutions(game);
      behavior.maybeAttack();
      expect(boatsSent(spy)).toHaveLength(0);
      expect(warshipsOrdered(spy, nation)).toHaveLength(expected);
    },
  );
});

// Synthetic seas: `nation` owns the land in the north, `enemy` the land in the south
describe("Nation boat routes on open water", () => {
  function setupSea(
    difficulty: Difficulty,
    width: number,
    height: number,
    isLand: (x: number, y: number) => boolean,
    southFrom: number,
  ) {
    const grid: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) grid.push(isLand(x, y) ? L : W);
    }
    const game = createGame({ width, height, grid }, { difficulty });
    for (const id of ["nation", "enemy", "navy"]) {
      game.addPlayer(new PlayerInfo(id, PlayerType.Nation, null, `${id}_id`));
    }
    const nation = game.player("nation_id");
    const enemy = game.player("enemy_id");
    const navy = game.player("navy_id");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.y(tile) < southFrom ? nation : enemy).conquer(tile);
    });
    nation.setTroops(100_000);
    enemy.setTroops(10_000);
    const random = new PseudoRandom(42);
    const emoji = new NationEmojiBehavior(random, game, nation);
    const behavior = new AiAttackBehavior(
      random,
      game,
      nation,
      0,
      0,
      0,
      new NationAllianceBehavior(random, game, nation, emoji),
      emoji,
      new NationWarshipBehavior(random, game, nation, emoji),
    );
    const warshipAt = (x: number, y: number) => {
      const tile = game.ref(x, y);
      navy.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
    };
    const landings = () =>
      vi
        .mocked(game.addExecution)
        .mock.calls.map((c) => c[0])
        .filter((e) => e instanceof TransportShipExecution)
        .map((e) => e["ref"] as number);
    vi.spyOn(game, "addExecution");
    return { game, enemy, behavior, warshipAt, landings };
  }

  // A 3-tile hop off a peninsula across a 4-tile strait; the enemy coast is only 30 tiles long
  const strait = (x: number, y: number) =>
    y <= 9 || (x <= 10 && y <= 11) || (y >= 14 && x <= 30);

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s: a short hop lands before a distant warship's shell arrives",
    async (difficulty) => {
      const { enemy, behavior, warshipAt, landings } = setupSea(
        difficulty,
        200,
        30,
        strait,
        14,
      );
      // In targeting range of the hop (about 145 tiles), but far too far to hit a 3-tile trip
      warshipAt(150, 12);
      expect(behavior.sendAttack(enemy)).toBe(true);
      expect(landings()).toHaveLength(1);
    },
  );

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s: holds the short hop when the warship is right next to it",
    async (difficulty) => {
      const { enemy, behavior, warshipAt, landings } = setupSea(
        difficulty,
        200,
        30,
        strait,
        14,
      );
      warshipAt(16, 12);
      expect(behavior.sendAttack(enemy)).toBe(false);
      expect(landings()).toHaveLength(0);
    },
  );

  // Open sea with a peninsula reaching towards the enemy coast at x <= 10
  const sea = (x: number, y: number) =>
    y <= 7 || (x <= 10 && y <= 20) || y >= 52;

  it("Impossible lands somewhere else when a warship sits on the direct crossing", async () => {
    const { game, enemy, behavior, warshipAt, landings } = setupSea(
      Difficulty.Impossible,
      400,
      60,
      sea,
      52,
    );
    warshipAt(5, 36);
    expect(behavior.sendAttack(enemy)).toBe(true);
    const [landing] = landings();
    expect(game.x(landing)).toBeGreaterThan(150);
  });

  it("Easy takes the direct crossing regardless", async () => {
    const { game, enemy, behavior, warshipAt, landings } = setupSea(
      Difficulty.Easy,
      400,
      60,
      sea,
      52,
    );
    warshipAt(5, 36);
    expect(behavior.sendAttack(enemy)).toBe(true);
    const [landing] = landings();
    expect(game.x(landing)).toBeLessThanOrEqual(20);
  });
});
