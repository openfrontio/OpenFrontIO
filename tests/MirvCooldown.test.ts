import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
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
let player3: Player;

describe("MIRV global launch cooldown", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
      new PlayerInfo("player3", PlayerType.Human, "c3", "p3"),
    ]);

    player1 = game.player("p1");
    player2 = game.player("p2");
    player3 = game.player("p3");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(10, 10));
    player3.conquer(game.ref(20, 20));

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

  test("blocks other players but not the launcher; relaunch restarts the timer", () => {
    (game.config() as TestConfig).setMirvLaunchCooldown(50);

    expect(game.mirvCooldownRemaining(player2)).toBe(0);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).not.toBe(false);

    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2); // init + spawn
    expect(player1.units(UnitType.MIRV)).toHaveLength(1);

    // Everyone else is blocked; the launcher is exempt (they still need a
    // ready silo — the one that just fired is reloading).
    expect(game.mirvCooldownRemaining(player2)).toBeGreaterThan(0);
    expect(game.mirvCooldownRemaining(player1)).toBe(0);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).toBe(false);
    player1.conquer(game.ref(1, 1));
    player1.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    expect(player1.canBuild(UnitType.MIRV, game.ref(10, 10))).not.toBe(false);

    // A blocked player's MIRV execution fizzles.
    game.addExecution(new MirvExecution(player2, game.ref(0, 0)));
    executeTicks(game, 2);
    expect(player2.units(UnitType.MIRV)).toHaveLength(0);

    // The launcher firing again mid-cooldown restarts the timer for others.
    executeTicks(game, 20);
    const before = game.mirvCooldownRemaining(player2);
    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2);
    expect(game.mirvCooldownRemaining(player2)).toBeGreaterThan(before);

    // Once the cooldown expires, others can launch again.
    executeTicks(game, 50);
    expect(game.mirvCooldownRemaining(player2)).toBe(0);
    expect(player2.canBuild(UnitType.MIRV, game.ref(10, 10))).not.toBe(false);
  });

  test("buildableUnits reports the remaining MIRV cooldown to blocked players only", () => {
    (game.config() as TestConfig).setMirvLaunchCooldown(50);

    const before = player2
      .buildableUnits(game.ref(10, 10))
      .find((u) => u.type === UnitType.MIRV);
    expect(before?.cooldown).toBeUndefined();

    game.addExecution(new MirvExecution(player1, game.ref(0, 0)));
    executeTicks(game, 2); // init + spawn

    const blocked = player2
      .buildableUnits(game.ref(10, 10))
      .find((u) => u.type === UnitType.MIRV);
    expect(blocked?.canBuild).toBe(false);
    expect(blocked?.cooldown).toBeGreaterThan(0);
    expect(blocked?.cooldown).toBeLessThanOrEqual(50);

    // The launcher sees no cooldown.
    const launcher = player1
      .buildableUnits(game.ref(0, 0))
      .find((u) => u.type === UnitType.MIRV);
    expect(launcher?.cooldown).toBeUndefined();
  });

  test("a launch fizzled by the cooldown applies no betrayal side effects", () => {
    (game.config() as TestConfig).setMirvLaunchCooldown(50);

    game.addExecution(new AllianceRequestExecution(player2, player3.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(player3, player2.id()));
    game.executeNextTick();
    expect(player2.isAlliedWith(player3)).toBe(true);

    // Both launch at player3 in the same tick. player1's execution runs
    // first and starts the cooldown; player2's fizzles and must not break
    // the alliance or mark player2 a traitor.
    game.addExecution(new MirvExecution(player1, game.ref(20, 20)));
    game.addExecution(new MirvExecution(player2, game.ref(20, 20)));
    executeTicks(game, 2);

    expect(player1.units(UnitType.MIRV)).toHaveLength(1);
    expect(player2.units(UnitType.MIRV)).toHaveLength(0);
    expect(player2.isAlliedWith(player3)).toBe(true);
    expect(player2.isTraitor()).toBe(false);
  });
});
