import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Cell,
  Difficulty,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

// Synthetic seas: `ownerAt` names the player owning each land tile (null is water)
function setupSea(
  difficulty: Difficulty,
  width: number,
  height: number,
  ownerAt: (x: number, y: number) => string | null,
) {
  const grid: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid.push(ownerAt(x, y) === null ? W : L);
  }
  const game = createGame({ width, height, grid }, { difficulty });
  const player = (name: string): Player => {
    const id = `${name}_id`;
    if (!game.hasPlayer(id)) {
      game.addPlayer(new PlayerInfo(name, PlayerType.Nation, null, id));
    }
    return game.player(id);
  };
  game.map().forEachTile((tile) => {
    const name = ownerAt(game.x(tile), game.y(tile));
    if (name !== null) player(name).conquer(tile);
  });
  // PlayerExecution isn't running, so set the boxes it would
  for (const p of game.players()) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of p.tiles()) {
      minX = Math.min(minX, game.x(t));
      minY = Math.min(minY, game.y(t));
      maxX = Math.max(maxX, game.x(t));
      maxY = Math.max(maxY, game.y(t));
    }
    p.largestClusterBoundingBox = {
      min: new Cell(minX, minY),
      max: new Cell(maxX, maxY),
    };
  }

  const nation = player("nation");
  nation.setTroops(1_000_000);
  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, nation);
  const behavior = new AiAttackBehavior(
    random,
    game,
    nation,
    0, // triggerRatio
    0, // reserveRatio
    0, // expandRatio
    new NationAllianceBehavior(random, game, nation, emoji),
    emoji,
    new NationWarshipBehavior(random, game, nation, emoji),
  );
  // Strong enough to be a juicy target, not so weak it counts as "very weak"
  const juicy = (p: Player, city: [number, number]) => {
    p.buildUnit(UnitType.City, game.ref(...city), {});
    p.setTroops(Math.floor(game.config().maxTroops(p) * 0.3));
  };
  const halfStrength = (p: Player) =>
    p.setTroops(Math.floor(game.config().maxTroops(p) * 0.5));
  vi.spyOn(game, "addExecution");
  const boats = () =>
    vi
      .mocked(game.addExecution)
      .mock.calls.map((c) => c[0])
      .filter((e) => e instanceof TransportShipExecution);
  const boatTargets = () => boats().map((e) => game.owner(e["ref"]));
  return { game, player, behavior, juicy, halfStrength, boats, boatTargets };
}

describe("Nation targets across the water", () => {
  // `nation` and `neighbor` share the north coast, `rich` owns the south coast.
  // Above 75% of our troops the neighbor isn't a juicy target.
  it.each([
    [Difficulty.Impossible, 0.9, true],
    [Difficulty.Impossible, 0.5, false],
    [Difficulty.Hard, 0.9, false],
  ])(
    "%s with a land neighbor at %f of our troops boats a juicy enemy across the water: %s",
    (difficulty, neighborShare, boats) => {
      const { player, behavior, juicy, boatTargets } = setupSea(
        difficulty,
        40,
        24,
        (x, y) =>
          y <= 7 ? (x < 20 ? "nation" : "neighbor") : y >= 16 ? "rich" : null,
      );
      player("neighbor").setTroops(player("nation").troops() * neighborShare);
      juicy(player("rich"), [20, 20]);
      behavior.maybeAttack();
      expect(boatTargets().includes(player("rich"))).toBe(boats);
    },
  );

  // Six small enemies straight across the strait, `rich` further along the same coast
  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s weighs a juicy enemy beyond six smaller, nearer ones",
    (difficulty) => {
      const { player, behavior, juicy, halfStrength, boatTargets } = setupSea(
        difficulty,
        100,
        24,
        (x, y) => {
          if (y <= 7) return x < 20 ? "nation" : null;
          if (y < 16) return null;
          return x < 18 ? `small${Math.floor(x / 3)}` : "rich";
        },
      );
      for (let i = 0; i < 6; i++) halfStrength(player(`small${i}`));
      juicy(player("rich"), [60, 20]);
      behavior.maybeAttack();
      expect(boatTargets()).toContain(player("rich"));
    },
  );

  // About 560 tiles apart, beyond Impossible's 500 and Hard's 300: with nobody nearer,
  // the island strategy still gets there, with a 1% beachhead boat
  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s sends only a beachhead beyond its boat range",
    (difficulty) => {
      const { player, behavior, juicy, boats, boatTargets } = setupSea(
        difficulty,
        620,
        24,
        (x, y) =>
          y <= 7 && x < 20 ? "nation" : y >= 16 && x >= 570 ? "rich" : null,
      );
      juicy(player("rich"), [600, 20]);
      behavior.maybeAttack();
      expect(boatTargets()).toEqual([player("rich")]);
      expect(boats()[0]["troops"]).toBe(10_000);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s without a land front sends warships at a blocker beyond its boat range",
    (difficulty) => {
      const { player, behavior, juicy, game } = setupSea(
        difficulty,
        620,
        24,
        (x, y) =>
          y <= 7 && x < 20 ? "nation" : y >= 16 && x >= 570 ? "rich" : null,
      );
      juicy(player("rich"), [600, 20]);
      const nation = player("nation");
      nation.buildUnit(UnitType.Port, game.ref(10, 7), {});
      nation.addGold(10_000_000n);
      const guard = game.ref(575, 12);
      player("navy").buildUnit(UnitType.Warship, guard, { patrolTile: guard });
      behavior.maybeAttack();
      const ordered = vi
        .mocked(game.addExecution)
        .mock.calls.map((c) => c[0])
        .filter(
          (e) =>
            e instanceof ConstructionExecution &&
            e["constructionType"] === UnitType.Warship,
        );
      expect(ordered.length).toBeGreaterThan(0);
    },
  );
});
