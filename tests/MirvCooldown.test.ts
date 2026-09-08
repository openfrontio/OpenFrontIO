import { MirvExecution } from "../src/core/execution/MIRVExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;

describe("MIRV global launch cooldown", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
    ]);

    player1 = game.player("p1");
    player2 = game.player("p2");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(10, 10));

    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});
    player2.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});

    player1.addGold(1_000_000_000n);
    player2.addGold(1_000_000_000n);
  });

  test("cooldown defaults to 60 seconds", () => {
    expect(game.config().mirvLaunchCooldown()).toBe(600);
  });

  test("MIRV cost stays flat at 25M after a launch", () => {
    expect(game.unitInfo(UnitType.MIRV).cost(game, player1)).toBe(25_000_000n);

    // MIRV targets must be owned tiles; player1 self-targets so player2's
    // territory and silo stay intact for later assertions.
    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2); // init + spawn
    expect(game.units(UnitType.MIRV)).toHaveLength(1);

    expect(game.unitInfo(UnitType.MIRV).cost(game, player1)).toBe(25_000_000n);
    expect(game.unitInfo(UnitType.MIRV).cost(game, player2)).toBe(25_000_000n);
  });

  test("no player can launch another MIRV until the cooldown expires", () => {
    (game.config() as TestConfig).setMirvLaunchCooldown(50);

    expect(game.mirvCooldownRemaining()).toBe(0);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).not.toBe(false);

    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2); // init + spawn
    expect(player1.units(UnitType.MIRV)).toHaveLength(1);
    expect(game.mirvCooldownRemaining()).toBeGreaterThan(0);

    // Neither the launcher nor anyone else can build a MIRV.
    expect(player1.canBuild(UnitType.MIRV, game.ref(10, 10))).toBe(false);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).toBe(false);

    // A MIRV execution added during the cooldown fizzles.
    game.addExecution(new MirvExecution(player2, game.ref(0, 0)));
    executeTicks(game, 2);
    expect(player2.units(UnitType.MIRV)).toHaveLength(0);

    // Once the cooldown expires, launching is possible again.
    executeTicks(game, 50);
    expect(game.mirvCooldownRemaining()).toBe(0);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).not.toBe(false);
  });

  test("buildableUnits reports the remaining MIRV cooldown", () => {
    (game.config() as TestConfig).setMirvLaunchCooldown(50);

    const before = player2
      .buildableUnits(game.ref(10, 10))
      .find((u) => u.type === UnitType.MIRV);
    expect(before?.cooldown).toBeUndefined();

    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2); // init + spawn

    const during = player2
      .buildableUnits(game.ref(10, 10))
      .find((u) => u.type === UnitType.MIRV);
    expect(during?.canBuild).toBe(false);
    expect(during?.cooldown).toBeGreaterThan(0);
    expect(during?.cooldown).toBeLessThanOrEqual(50);
  });
});
