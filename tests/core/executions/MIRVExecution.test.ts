import { MirvExecution } from "../../../src/core/execution/MIRVExecution";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("MIRVExecution", () => {
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

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    // Give player territory and missile silo
    for (let x = 5; x < 15; x++) {
      for (let y = 5; y < 15; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          player.conquer(tile);
        }
      }
    }
    player.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});

    // Give other player territory closer to player
    for (let x = 25; x < 75; x++) {
      for (let y = 25; y < 75; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }
  });

  test("MIRV should launch successfully", async () => {
    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    // Execute until MIRV is launched (need 2 ticks: 1 to init execution, 1 to spawn MIRV)
    executeTicks(game, 2);

    // Verify MIRV unit was created
    expect(player.units(UnitType.MIRV)).toHaveLength(1);

    // Verify execution is still active (MIRV is flying)
    expect(mirvExec.isActive()).toBe(true);
  });

  test("MIRV should break alliances on launch", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    expect(player.isAlliedWith(otherPlayer)).toBe(true);

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // Alliance should be broken
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
    expect(player.isTraitor()).toBe(true);
  });

  test("MIRV should separate into warheads", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    expect(player.units(UnitType.MIRV)).toHaveLength(1);
    expect(mirvExec.isActive()).toBe(true);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    expect(player.units(UnitType.MIRV)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);

    // Wait one tick for NukeExecution
    executeTicks(game, 1);

    // Exact number of warheads may vary due to randomness, but should be more than 0
    expect(player.units(UnitType.MIRVWarhead).length).toBeGreaterThan(0);
  });

  test("MIRV warheads should only target tiles owned by target player", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    // Also give player some territory near the target area to test filtering
    for (let x = 100; x < 120; x++) {
      for (let y = 100; y < 120; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && game.owner(tile) === otherPlayer) {
          otherPlayer.relinquish(tile);
          player.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(150, 150);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);
    expect(player.units(UnitType.MIRV)).toHaveLength(1);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    executeTicks(game, 1);

    const warheads = player.units(UnitType.MIRVWarhead);
    expect(warheads.length).toBeGreaterThan(0);

    // Check all warhead targets are owned by otherPlayer
    for (const warhead of warheads) {
      const target = warhead.targetTile();
      if (target) {
        const owner = game.owner(target);
        expect(owner).toBe(otherPlayer);
      }
    }
  });

  test("MIRV warheads should be distributed with minimum spacing", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);
    expect(player.units(UnitType.MIRV)).toHaveLength(1);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    executeTicks(game, 1);

    const warheads = player.units(UnitType.MIRVWarhead);
    expect(warheads.length).toBeGreaterThan(0);

    const targets = warheads.map((w) => w.targetTile());

    // Check that targets have minimum spacing (minimumSpread = 55 from MIRVExecution)
    const minimumSpread = 55;
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const dist = game.manhattanDist(targets[i]!, targets[j]!);
        expect(dist).toBeGreaterThanOrEqual(minimumSpread);
      }
    }
  });

  test("MIRV should display warning message on launch", async () => {
    const displaySpy = vi.spyOn(game, "displayIncomingUnit");

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    expect(displaySpy).toHaveBeenCalled();
    const callArgs = displaySpy.mock.calls[0];
    expect(callArgs[1]).toContain("MIRV INBOUND");
    expect(callArgs[2]).toBe(MessageType.MIRV_INBOUND);
    expect(callArgs[3]).toBe(otherPlayer.id());
  });

  test("MIRV should not launch if player cannot build it", async () => {
    // Remove player's missile silo
    const silos = player.units(UnitType.MissileSilo);
    for (const silo of silos) {
      silo.delete(false);
    }

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // MIRV should not be launched
    expect(player.units(UnitType.MIRV)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);
  });

  test("MIRV should not launch when targeting terra nullius", async () => {
    // Find an unowned land tile near player territory
    let unownedTile: any = null;
    for (let x = 20; x < 25; x++) {
      for (let y = 20; y < 25; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          unownedTile = tile;
          break;
        }
      }

      if (unownedTile) {
        break;
      }
    }

    expect(unownedTile).not.toBeNull();

    const mirvExec = new MirvExecution(player, unownedTile!);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // MIRV should NOT launch against terra nullius
    expect(player.units(UnitType.MIRV)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);

    // Should not break any alliance or mark as traitor (since no player owns it)
    expect(player.isTraitor()).toBe(false);
  });

  test("MIRV should launch when targeting own territory without breaking alliances", async () => {
    const playerTile = Array.from(player.tiles())[0];
    const mirvExec = new MirvExecution(player, playerTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // Expect MIRV to launch successfully without marking player as traitor
    expect(player.units(UnitType.MIRV)).toHaveLength(1);
    expect(player.isTraitor()).toBe(false);
  });
});
