import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { constructionExecution, executeTicks } from "../../util/utils";

let game: Game;
const gameID: GameID = "game_id";
let attacker: Player;
let defender: Player;
let far_defender: Player;
let middle_defender: Player;

describe("SAM", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });
    const defender_info = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    const middle_defender_info = new PlayerInfo(
      "middle_defender_id",
      PlayerType.Human,
      null,
      "middle_defender_id",
    );
    const far_defender_info = new PlayerInfo(
      "far_defender_id",
      PlayerType.Human,
      null,
      "far_defender_id",
    );
    const attacker_info = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(defender_info);
    game.addPlayer(middle_defender_info);
    game.addPlayer(far_defender_info);
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(defender_info.id).info(),
        game.ref(1, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(middle_defender_info.id).info(),
        game.ref(50, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(far_defender_info.id).info(),
        game.ref(199, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(attacker_info.id).info(),
        game.ref(7, 7),
      ),
    );

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
    middle_defender = game.player("middle_defender_id");
    far_defender = game.player("far_defender_id");

    constructionExecution(game, attacker, 7, 7, UnitType.MissileSilo);
  });

  test("one sam should take down one nuke", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Sam will only target nukes it can destroy before it reaches its target
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });
    executeTicks(game, 3);

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("sam should only get one nuke at a time", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));
    attacker.buildUnit(UnitType.AtomBomb, game.ref(2, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });
    attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 2), {
      targetTile: game.ref(1, 3),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(1, 2), targetable: true },
        { tile: game.ref(1, 3), targetable: true },
      ],
    });
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(2);

    executeTicks(game, 3);

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("one sam should take down one MIRV warhead", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    attacker.buildUnit(UnitType.MIRVWarhead, game.ref(1, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });
    executeTicks(game, 3);

    expect(attacker.units(UnitType.MIRVWarhead)).toHaveLength(0);
  });

  test("sam should intercept an in-flight MIRV warhead like any other nuke", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Warhead launched from a distant separation point at a tile near the SAM
    const nukeExecution = new NukeExecution(
      UnitType.MIRVWarhead,
      attacker,
      game.ref(3, 3),
      game.ref(60, 60),
    );
    game.addExecution(nukeExecution);

    executeTicks(game, 40);

    expect(nukeExecution.isActive()).toBeFalsy();
    expect(attacker.units(UnitType.MIRVWarhead)).toHaveLength(0);
    expect(sam.isInCooldown()).toBeTruthy();
  });

  test("sam should cooldown as long as configured", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});

    game.addExecution(new SAMLauncherExecution(defender, null, sam));
    expect(sam.isInCooldown()).toBeFalsy();
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(1, 3),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();

    for (let i = 0; i < game.config().SAMCooldown() - 3; i++) {
      game.executeNextTick();
      expect(sam.isInCooldown()).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(sam.isInCooldown()).toBeFalsy();
  });

  test("two sams should not target twice same nuke", async () => {
    const sam1 = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam1));
    const sam2 = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 2), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam2));
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(1, 3),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(1, 2), targetable: true },
        { tile: game.ref(1, 3), targetable: true },
      ],
    });

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();
    expect([sam1, sam2].filter((s) => s.isInCooldown())).toHaveLength(1);
  });

  test("SAMs should target close to launch site", async () => {
    const targetDistance = 199;
    // Close SAM: should intercept the nuke
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    const nukeExecution = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      game.ref(targetDistance, 1),
      null,
    );
    game.addExecution(nukeExecution);
    // Long distance nuke: compute the proper number of ticks
    const ticksToExecute = Math.ceil(
      targetDistance / game.config().nukeSpeed(UnitType.AtomBomb) + 1,
    );
    executeTicks(game, ticksToExecute);

    expect(nukeExecution.isActive()).toBeFalsy();
    expect(sam.isInCooldown()).toBeTruthy();
  });

  test("SAMs should target only nukes aimed at nearby targets if not close to launch site", async () => {
    const targetDistance = 199;
    // Middle SAM: should not intercept the nuke
    const sam1 = middle_defender.buildUnit(
      UnitType.SAMLauncher,
      game.ref(50, 1),
      {},
    );
    game.addExecution(new SAMLauncherExecution(defender, null, sam1));

    // Far SAM: Should intercept the nuke. Use the far_defender so the SAM can be built
    const sam2 = far_defender.buildUnit(
      UnitType.SAMLauncher,
      game.ref(targetDistance, 1),
      {},
    );
    game.addExecution(new SAMLauncherExecution(far_defender, null, sam2));

    const nukeExecution = new NukeExecution(
      UnitType.AtomBomb,
      attacker,
      game.ref(targetDistance, 1),
      null,
    );
    game.addExecution(nukeExecution);
    // Long distance nuke: compute the proper number of ticks
    const ticksToExecute = Math.ceil(
      targetDistance / game.config().nukeSpeed(UnitType.AtomBomb) + 1,
    );
    executeTicks(game, ticksToExecute);
    expect(nukeExecution.isActive()).toBeFalsy();
    expect(sam1.isInCooldown()).toBeFalsy();
    expect(sam2.isInCooldown()).toBeTruthy();
  });

  test("SAM should have increased level after upgrade", async () => {
    defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    expect(defender.units(UnitType.SAMLauncher)[0].level()).toEqual(1);

    const upgradeStructureExecution = new UpgradeStructureExecution(
      defender,
      defender.units(UnitType.SAMLauncher)[0].id(),
    );
    game.addExecution(upgradeStructureExecution);
    executeTicks(game, 2);

    expect(defender.units(UnitType.SAMLauncher)[0].level()).toEqual(2);
  });

  test("SAM should reload expired missile timers even when not in cooldown", async () => {
    // Upgrading to level 2 pushes a timer for the new slot. queue.length(1) < level(2)
    // so isInCooldown() is false, but the expired timer still needs to be cleaned up.
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    sam.increaseLevel();
    expect(sam.level()).toBe(2);

    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    expect(sam.missileTimerQueue()).toHaveLength(1);
    expect(sam.isInCooldown()).toBeFalsy();

    // Wait for the timer to expire — reload must fire even though isInCooldown() is false
    executeTicks(game, game.config().SAMCooldown() + 1);

    expect(sam.missileTimerQueue()).toHaveLength(0);
  });

  test("SAM should prioritize nuke targeting close to SAM launcher over distant nuke", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Distant AtomBomb landing far away (at 10, 1)
    attacker.buildUnit(UnitType.AtomBomb, game.ref(2, 1), {
      targetTile: game.ref(10, 1),
      trajectory: [
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(5, 3), targetable: true },
        { tile: game.ref(10, 1), targetable: true },
      ],
    });

    // Close AtomBomb targeting right on the SAM (1, 1)
    const dangerousNuke = attacker.buildUnit(
      UnitType.AtomBomb,
      game.ref(1, 2),
      {
        targetTile: game.ref(1, 1),
        trajectory: [
          { tile: game.ref(1, 1), targetable: true },
          { tile: game.ref(1, 2), targetable: true },
          { tile: game.ref(1, 1), targetable: true },
        ],
      },
    );

    executeTicks(game, 3);

    // The dangerous nuke aimed directly at the SAM launcher should be intercepted first
    expect(dangerousNuke.reachedTarget()).toBeFalsy();
    expect(dangerousNuke.wasDestroyedByEnemy()).toBeTruthy();
  });

  test("upgraded SAM launcher should launch multiple missiles in a single tick if multiple targets arrive", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    sam.increaseLevel(); // Level 2 allows 2 missile slots
    sam.reloadMissile(); // Reload the slot added by increaseLevel()
    expect(sam.level()).toBe(2);
    expect(sam.isInCooldown()).toBeFalsy();

    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    const nuke1 = attacker.buildUnit(UnitType.AtomBomb, game.ref(2, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });

    const nuke2 = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 2), {
      targetTile: game.ref(1, 3),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(1, 2), targetable: true },
        { tile: game.ref(1, 3), targetable: true },
      ],
    });

    executeTicks(game, 3);

    // Both nukes should be intercepted simultaneously by the level-2 SAM launcher
    expect(nuke1.reachedTarget()).toBeFalsy();
    expect(nuke1.wasDestroyedByEnemy()).toBeTruthy();
    expect(nuke2.reachedTarget()).toBeFalsy();
    expect(nuke2.wasDestroyedByEnemy()).toBeTruthy();
  });

  test("high-level SAM launcher should shoot down multiple MIRV warheads arriving in the same tick", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    for (let i = 1; i < 50; i++) {
      sam.increaseLevel();
      sam.reloadMissile();
    }
    expect(sam.level()).toBe(50);
    expect(sam.isInCooldown()).toBeFalsy();

    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    const warheads: Unit[] = [];
    for (let i = 0; i < 10; i++) {
      const warhead = attacker.buildUnit(
        UnitType.MIRVWarhead,
        game.ref(1, 2 + i),
        {
          targetTile: game.ref(1, 15 + i),
          trajectory: [
            { tile: game.ref(1, 1), targetable: true },
            { tile: game.ref(1, 2 + i), targetable: true },
            { tile: game.ref(1, 15 + i), targetable: true },
          ],
        },
      );
      warheads.push(warhead);
    }

    expect(attacker.units(UnitType.MIRVWarhead)).toHaveLength(10);

    executeTicks(game, 3);

    expect(attacker.units(UnitType.MIRVWarhead)).toHaveLength(0);
    for (const w of warheads) {
      expect(w.reachedTarget()).toBeFalsy();
      expect(w.wasDestroyedByEnemy()).toBeTruthy();
    }
  });

  test("SAM launcher should intercept nuke in-flight before reaching detonation tile at SAM range edge", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, game.ref(1, 1), sam));
    // Nuke whose target is inside SAM range but near its edge
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(149, 1), {
      targetTile: game.ref(17, 1),
      trajectory: [
        { tile: game.ref(149, 1), targetable: true },
        { tile: game.ref(137, 1), targetable: true },
        { tile: game.ref(125, 1), targetable: true },
        { tile: game.ref(113, 1), targetable: true },
        { tile: game.ref(101, 1), targetable: true },
        { tile: game.ref(89, 1), targetable: true },
        { tile: game.ref(77, 1), targetable: true },
        { tile: game.ref(65, 1), targetable: true },
        { tile: game.ref(53, 1), targetable: true },
        { tile: game.ref(41, 1), targetable: true },
        { tile: game.ref(29, 1), targetable: true },
        { tile: game.ref(17, 1), targetable: true },
      ],
    });

    executeTicks(game, 11);
    // Nuke should be intercepted in-flight before detonating on destination tile
    expect(nuke.reachedTarget()).toBeFalsy();
    expect(nuke.wasDestroyedByEnemy()).toBeTruthy();
  });

  test("SAM reloads all expired missile slots in a single tick when fully in cooldown", async () => {
    // Verifies the while-loop fix: previously only one slot reloaded per tick,
    // leaving the SAM stuck in cooldown for extra ticks if multiple slots expired simultaneously.
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    sam.increaseLevel();
    sam.increaseLevel();
    sam.reloadMissile();
    sam.reloadMissile();
    expect(sam.level()).toBe(3);
    expect(sam.isInCooldown()).toBeFalsy();

    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Fill all 3 slots at the same game tick so all cooldowns expire simultaneously.
    sam.launch();
    sam.launch();
    sam.launch();
    expect(sam.isInCooldown()).toBeTruthy();
    expect(sam.missileTimerQueue()).toHaveLength(3);

    // Advance past the cooldown duration. All three timers share the same start tick
    // so they all expire on the same tick — the while-loop must drain all of them.
    executeTicks(game, game.config().SAMCooldown() + 1);

    expect(sam.missileTimerQueue()).toHaveLength(0);
    expect(sam.isInCooldown()).toBeFalsy();
  });

  test("SAM does not fire at a MIRV warhead while its waitTicks are still counting down", async () => {
    // Verifies the waitTicks fix: SAM interception timing now accounts for the
    // warhead's wait period, so it doesn't schedule a shot before the warhead moves.
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    // Spawn a warhead directly on top of the SAM tile with a long wait before it flies.
    // Without the waitTicks fix the SAM would try to fire immediately (tick 0).
    const waitTicks = 20;
    const warheadExec = new NukeExecution(
      UnitType.MIRVWarhead,
      attacker,
      game.ref(3, 1), // target outside SAM range
      game.ref(1, 1), // separateDst: right on the SAM
      game.config().nukeSpeed(UnitType.MIRVWarhead),
      waitTicks,
    );
    game.addExecution(warheadExec);

    //init + first tick of NukeExec
    game.executeNextTick();
    game.executeNextTick();

    const warhead = warheadExec.getNuke()!;
    expect(warhead).toBeTruthy();

    // Advance through the entire wait period.
    for (let i = 0; i < waitTicks; i++) {
      game.executeNextTick();
      if (warhead.nukeState().waitTicks > 0) {
        // SAM must not have consumed a missile slot while the warhead is still waiting.
        expect(sam.missileTimerQueue()).toHaveLength(0);
      }
    }
    expect(warhead.nukeState().targetedBySam).toBe(true);
  });
});
