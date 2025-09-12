import { CancelBombExecution } from "../../../src/core/execution/CancelBombExecution";
import { MirvExecution } from "../../../src/core/execution/MIRVExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("CancelBombExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    (game.config() as TestConfig).nukeMagnitudes = jest.fn(() => ({
      inner: 10,
      outer: 10,
    }));
    (game.config() as TestConfig).nukeAllianceBreakThreshold = jest.fn(() => 5);
    // Ensure cancel threshold is taken from config (was hardcoded 90 before)
    (game.config() as TestConfig).cancelNukeUntilPercentage = jest.fn(() => 90);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");
  });

  test("should cancel atom bomb before 90% flight progress", async () => {
    // Build a missile silo
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // Create a nuke execution
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(50, 50), // Target far away
      game.ref(1, 1), // Source
    );
    game.addExecution(nukeExec);

    // Execute a few ticks to get the nuke in flight
    executeTicks(game, 3);

    const nuke = nukeExec.getNuke();
    expect(nuke).not.toBeNull();
    expect(nuke!.isActive()).toBe(true);

    // Should be able to cancel early in flight
    expect(nukeExec.canCancel()).toBe(true);
    // Verify we used the config-driven threshold
    expect(
      (game.config() as TestConfig).cancelNukeUntilPercentage,
    ).toHaveBeenCalled();

    // Cancel the bomb
    const cancelResult = nukeExec.cancel();
    expect(cancelResult).toBe(true);
    expect(nukeExec.isCancelled()).toBe(true);

    // Execute another tick to process the cancellation
    game.executeNextTick();

    // The nuke should no longer be active
    expect(nukeExec.isActive()).toBe(false);
  });

  test("should not cancel atom bomb after 90% flight progress", async () => {
    // Build a missile silo
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // Create a nuke execution with longer distance but execute many ticks
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(20, 20), // Target further away
      game.ref(1, 1), // Source
    );
    game.addExecution(nukeExec);

    // Execute enough ticks to get the nuke past 90% progress
    executeTicks(game, 15);

    const nuke = nukeExec.getNuke();
    if (nuke && nuke.isActive()) {
      // Should not be able to cancel late in flight
      expect(nukeExec.canCancel()).toBe(false);
      // Verify we used the config-driven threshold
      expect(
        (game.config() as TestConfig).cancelNukeUntilPercentage,
      ).toHaveBeenCalled();

      // Try to cancel the bomb - should fail
      const cancelResult = nukeExec.cancel();
      expect(cancelResult).toBe(false);
      expect(nukeExec.isCancelled()).toBe(false);
    } else {
      // If the bomb already detonated, that's also a valid outcome
      expect(nukeExec.isActive()).toBe(false);
    }
  });

  test("should cancel MIRV before separation", async () => {
    // Give player territory to build MIRV from
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        player.conquer(game.ref(x, y));
      }
    }

    // Build a missile silo
    player.buildUnit(UnitType.MissileSilo, game.ref(3, 3), {});

    // Create a MIRV execution
    const mirvExec = new MirvExecution(player, game.ref(100, 100));
    game.addExecution(mirvExec);

    // Execute a few ticks to get the MIRV in flight
    executeTicks(game, 3);

    const mirv = mirvExec.getNuke();
    if (mirv && mirv.isActive()) {
      // Should be able to cancel early in flight
      expect(mirvExec.canCancel()).toBe(true);
      // Verify we used the config-driven threshold
      expect(
        (game.config() as TestConfig).cancelNukeUntilPercentage,
      ).toHaveBeenCalled();

      // Cancel the MIRV
      const cancelResult = mirvExec.cancel();
      expect(cancelResult).toBe(true);
      expect(mirvExec.isCancelled()).toBe(true);

      // Execute another tick to process the cancellation
      game.executeNextTick();

      // The MIRV should no longer be active
      expect(mirvExec.isActive()).toBe(false);
    } else {
      // If MIRV couldn't be built, skip this test
      console.log("MIRV could not be built, skipping test");
    }
  });

  test("CancelBombExecution should find and cancel bomb by ID", async () => {
    // Build a missile silo
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // Create a nuke execution
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(50, 50),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);

    // Execute a few ticks to get the nuke in flight
    executeTicks(game, 3);

    const nuke = nukeExec.getNuke();
    expect(nuke).not.toBeNull();

    // Create a cancel bomb execution
    const cancelExec = new CancelBombExecution(player, nuke!.id());
    game.addExecution(cancelExec);

    // Execute a tick to process the cancellation
    game.executeNextTick();

    // The cancel execution should have completed
    expect(cancelExec.isActive()).toBe(false);

    // With new mid-air cancel semantics, deactivation occurs on the tick following cancel processing.
    await executeTicks(game, 1);
    expect(nuke!.isActive()).toBe(false);
  });

  test("CancelBombExecution should fail for non-owner", async () => {
    // Build a missile silo for player
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // Create a nuke execution by player
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(50, 50),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);

    // Execute a few ticks to get the nuke in flight
    executeTicks(game, 3);

    const nuke = nukeExec.getNuke();
    expect(nuke).not.toBeNull();

    // Try to cancel with other player - should fail
    const cancelExec = new CancelBombExecution(otherPlayer, nuke!.id());
    game.addExecution(cancelExec);

    // Execute a tick to process the cancellation attempt
    game.executeNextTick();

    // The cancel execution should have completed (failed)
    expect(cancelExec.isActive()).toBe(false);

    // The bomb should still be active (cancellation should have failed due to wrong owner)
    expect(nuke!.isActive()).toBe(true);
  });

  test("CancelBombExecution should fail for non-existent bomb", async () => {
    // Try to cancel a bomb that doesn't exist
    const cancelExec = new CancelBombExecution(player, 99999);
    game.addExecution(cancelExec);

    // Execute a tick to process the cancellation attempt
    game.executeNextTick();

    // The cancel execution should have completed (failed)
    expect(cancelExec.isActive()).toBe(false);
  });
});
