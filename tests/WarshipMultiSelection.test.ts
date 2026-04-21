import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Warship multi-selection (MoveWarshipExecution)", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("p1", PlayerType.Human, null, "p1"),
        new PlayerInfo("p2", PlayerType.Human, null, "p2"),
      ],
    );
    while (game.inSpawnPhase()) game.executeNextTick();
    player1 = game.player("p1");
    player2 = game.player("p2");
  });

  test("moving multiple warships via array MoveWarshipExecution updates all patrol tiles", () => {
    const w1 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    const w2 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 2, 10), {
      patrolTile: game.ref(coastX + 2, 10),
    });
    const w3 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 3, 10), {
      patrolTile: game.ref(coastX + 3, 10),
    });

    game.addExecution(new WarshipExecution(w1));
    game.addExecution(new WarshipExecution(w2));
    game.addExecution(new WarshipExecution(w3));

    const sharedTarget = game.ref(coastX + 5, 15);
    // Single execution with array of ids — the new unified API
    game.addExecution(
      new MoveWarshipExecution(
        player1,
        [w1.id(), w2.id(), w3.id()],
        sharedTarget,
      ),
    );

    executeTicks(game, 5);

    expect(w1.patrolTile()).toBe(sharedTarget);
    expect(w2.patrolTile()).toBe(sharedTarget);
    expect(w3.patrolTile()).toBe(sharedTarget);
  });

  test("moving multiple warships to different targets works independently", () => {
    const w1 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    const w2 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 2, 10), {
      patrolTile: game.ref(coastX + 2, 10),
    });

    game.addExecution(new WarshipExecution(w1));
    game.addExecution(new WarshipExecution(w2));

    const target1 = game.ref(coastX + 3, 12);
    const target2 = game.ref(coastX + 4, 14);

    game.addExecution(new MoveWarshipExecution(player1, [w1.id()], target1));
    game.addExecution(new MoveWarshipExecution(player1, [w2.id()], target2));

    executeTicks(game, 5);

    expect(w1.patrolTile()).toBe(target1);
    expect(w2.patrolTile()).toBe(target2);
  });

  test("enemy cannot move player's warships via MoveWarshipExecution", () => {
    const originalTile = game.ref(coastX + 1, 10);
    const w1 = player1.buildUnit(UnitType.Warship, originalTile, {
      patrolTile: originalTile,
    });
    game.addExecution(new WarshipExecution(w1));

    new MoveWarshipExecution(player2, [w1.id()], game.ref(coastX + 5, 15)).init(
      game,
      0,
    );

    expect(w1.patrolTile()).toBe(originalTile);
  });

  test("MoveWarshipExecution on destroyed warship does not throw", () => {
    const w1 = player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    w1.delete();

    const exec = new MoveWarshipExecution(
      player1,
      [w1.id()],
      game.ref(coastX + 5, 15),
    );
    expect(() => exec.init(game, 0)).not.toThrow();
    expect(exec.isActive()).toBe(false);
  });

  test("batch move does not affect warships owned by other players", () => {
    const p1tile = game.ref(coastX + 1, 10);
    const p2tile = game.ref(coastX + 2, 10);

    const w1 = player1.buildUnit(UnitType.Warship, p1tile, {
      patrolTile: p1tile,
    });
    const w2 = player2.buildUnit(UnitType.Warship, p2tile, {
      patrolTile: p2tile,
    });

    game.addExecution(new WarshipExecution(w1));
    game.addExecution(new WarshipExecution(w2));

    const target = game.ref(coastX + 5, 15);

    // player1 sends both IDs — but w2 belongs to player2
    game.addExecution(
      new MoveWarshipExecution(player1, [w1.id(), w2.id()], target),
    );

    executeTicks(game, 5);

    expect(w1.patrolTile()).toBe(target);
    expect(w2.patrolTile()).toBe(p2tile); // unchanged — wrong owner
  });
});
