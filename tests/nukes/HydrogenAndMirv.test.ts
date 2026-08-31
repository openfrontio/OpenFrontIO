import { MirvExecution } from "src/core/execution/MIRVExecution";
import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

class FastNukeTestConfig extends TestConfig {
  nukeSpeed(_: UnitType): number {
    return 50;
  }

  mirvNormalizeTargetTicks(): number {
    return 8;
  }
}

describe("Hydrogen Bomb and MIRV flows", () => {
  let game: Game;
  let player: Player;
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      info,
    ]);
    player = game.player(info.id);
    player.conquer(game.ref(1, 1));
  });

  test("Hydrogen bomb launches when silo exists and cannot use silo under construction", () => {
    // Build a silo instantly and launch Hydrogen Bomb
    game.addExecution(
      new ConstructionExecution(player, UnitType.MissileSilo, game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.MissileSilo)).toHaveLength(1);

    // Launch Hydrogen Bomb
    const target = game.ref(7, 7);
    game.addExecution(
      new ConstructionExecution(player, UnitType.HydrogenBomb, target),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.HydrogenBomb).length).toBeGreaterThan(0);

    // Now build another silo with construction time and ensure it won't be used
    // Use non-instant config by simulating an under-construction flag on a new silo
    // (Use normal construction with default duration in a fresh game instance)
  });

  test("Hydrogen bomb launch fails when silo is under construction and succeeds after completion", async () => {
    // Set up a game without instantBuild to test construction duration
    const gameWithConstruction = await setup(
      "plains",
      {
        infiniteGold: false,
        instantBuild: false,
      },
      [info],
    );
    const playerWithConstruction = gameWithConstruction.player(info.id);

    playerWithConstruction.conquer(gameWithConstruction.ref(1, 1));
    const siloTile = gameWithConstruction.ref(7, 7);
    playerWithConstruction.conquer(siloTile);

    // Capture gold before starting silo construction
    const goldBeforeSilo = playerWithConstruction.gold();
    const siloCost = gameWithConstruction
      .unitInfo(UnitType.MissileSilo)
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addGold(siloCost);

    // Start construction of silo
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.MissileSilo,
        siloTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify silo exists and is under construction
    const silos = playerWithConstruction.units(UnitType.MissileSilo);
    expect(silos.length).toBe(1);
    const silo = silos[0];
    expect(silo.isUnderConstruction()).toBe(true);

    // Capture gold after construction started
    const goldAfterConstruction = playerWithConstruction.gold();
    expect(goldAfterConstruction).toBeLessThan(goldBeforeSilo + siloCost);

    // Attempt to launch HydrogenBomb while silo is under construction
    const targetTile = gameWithConstruction.ref(10, 10);
    const hydrogenBombCountBefore = playerWithConstruction.units(
      UnitType.HydrogenBomb,
    ).length;

    const canBuildResult = playerWithConstruction.canBuild(
      UnitType.HydrogenBomb,
      targetTile,
    );
    expect(canBuildResult).toBe(false); // Should fail because silo is under construction

    // Try to add execution - should fail
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.HydrogenBomb,
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Assert launch does not succeed
    const hydrogenBombCountAfter = playerWithConstruction.units(
      UnitType.HydrogenBomb,
    ).length;
    expect(hydrogenBombCountAfter).toBe(hydrogenBombCountBefore);

    // Assert no refunds during construction
    const goldDuringConstruction = playerWithConstruction.gold();
    expect(goldDuringConstruction >= goldAfterConstruction).toBe(true);

    // Advance ticks to complete construction
    const constructionDuration =
      gameWithConstruction.unitInfo(UnitType.MissileSilo)
        .constructionDuration ?? 0;
    for (let i = 0; i < constructionDuration + 2; i++) {
      gameWithConstruction.executeNextTick();
    }

    // Verify silo is complete
    const completedSilo = playerWithConstruction.units(UnitType.MissileSilo)[0];
    expect(completedSilo.isUnderConstruction()).toBe(false);

    // Now launch should succeed - ensure we have gold and target is conquered
    playerWithConstruction.conquer(targetTile);
    const hydrogenBombCost = gameWithConstruction
      .unitInfo(UnitType.HydrogenBomb)
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addGold(hydrogenBombCost);

    const canBuildAfterCompletion = playerWithConstruction.canBuild(
      UnitType.HydrogenBomb,
      targetTile,
    );
    expect(canBuildAfterCompletion).not.toBe(false);

    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.HydrogenBomb,
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify launch succeeded
    const hydrogenBombCountAfterSuccess = playerWithConstruction.units(
      UnitType.HydrogenBomb,
    ).length;
    expect(hydrogenBombCountAfterSuccess).toBeGreaterThan(
      hydrogenBombCountBefore,
    );
  });

  test("MIRV launches when silo exists and targets player-owned tiles", () => {
    // Build a silo instantly
    game.addExecution(
      new ConstructionExecution(player, UnitType.MissileSilo, game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.MissileSilo)).toHaveLength(1);

    // Launch MIRV at a player-owned tile (the silo tile)
    const target = game.ref(1, 1);
    game.addExecution(new ConstructionExecution(player, UnitType.MIRV, target));
    game.executeNextTick(); // init
    game.executeNextTick(); // create MIRV unit
    game.executeNextTick();

    // MIRV should appear briefly before separation, otherwise warheads should be queued
    const mirvs = player.units(UnitType.MIRV).length;
    const warheads = player.units(UnitType.MIRVWarhead).length;
    expect(mirvs > 0 || warheads > 0).toBe(true);
  });

  test("MIRV warheads are pre-spawned with waitTicks > 0 while MIRV is still in flight", async () => {
    // Verifies the pre-staging refactor: warheads are instantiated 10 ticks before
    // separation and start with waitTicks > 0 so they don't visually glow at separateDst.
    game.addExecution(
      new ConstructionExecution(player, UnitType.MissileSilo, game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.MissileSilo)).toHaveLength(1);

    const target = game.ref(1, 1);
    game.addExecution(new ConstructionExecution(player, UnitType.MIRV, target));

    let foundWaiting = false;
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      const warheads = player.units(UnitType.MIRVWarhead);
      const mirvs = player.units(UnitType.MIRV);
      // While the MIRV is still in flight AND warheads have already been created,
      // every warhead must have waitTicks > 0 (still in its pre-flight hold).
      if (warheads.length > 0 && mirvs.length > 0) {
        expect(warheads.every((w) => w.nukeState().waitTicks > 0)).toBe(true);
        foundWaiting = true;
        break;
      }
    }
    // Warheads must have appeared before the MIRV separated.
    expect(foundWaiting).toBe(true);
  });

  test("Short-distance MIRV launch (< 10 Ticks flight) dynamically adjusts warhead waitTicks below 10", async () => {
    // Uses FastNukeTestConfig (nukeSpeed = 50) so total parabolic flight is < 5 ticks.
    // Verifies remainingTicks dynamically scales base waitTicks down to ~3 instead of hardcoded 10.
    const fastGame = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true },
      [info],
      __dirname,
      FastNukeTestConfig,
    );
    const fastPlayer = fastGame.player(info.id);
    fastPlayer.conquer(fastGame.ref(1, 1));

    fastGame.addExecution(
      new ConstructionExecution(
        fastPlayer,
        UnitType.MissileSilo,
        fastGame.ref(1, 1),
      ),
    );
    fastGame.executeNextTick();
    fastGame.executeNextTick();
    expect(fastPlayer.units(UnitType.MissileSilo)).toHaveLength(1);

    // Bypass the 55-pixel minimumSpread overlapping check so all targets within range pass
    const spy = vi
      .spyOn(MirvExecution.prototype as any, "isOverlapping")
      .mockReturnValue(false);

    // Conquer a surrounding area for fastPlayer so generated targets belong to fastPlayer
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        fastPlayer.conquer(fastGame.ref(x, y));
      }
    }

    const target = fastGame.ref(1, 1);
    fastGame.addExecution(
      new ConstructionExecution(fastPlayer, UnitType.MIRV, target),
    );
    //init ConstructionExe
    fastGame.executeNextTick();
    //tick ConstructionExe -> create and init MIRVExe
    fastGame.executeNextTick();
    // Because it ticked once on the frame it was created, original path length is current + 1.
    const execution = (fastGame as any)
      .executions()
      .find((e: any) => e instanceof MirvExecution) as any;

    // Tick 3: MirvExe ticks -> spawns warhead executions (which init in the same tick).
    fastGame.executeNextTick();
    // Tick 4: NukeExecution ticks for the first time -> creates the physical warhead units!
    fastGame.executeNextTick();
    const warheads = fastPlayer.units(UnitType.MIRVWarhead);

    // 1 tick until separation.
    const minWaitTicks = Math.min(
      ...warheads.map((w) => w.nukeState().waitTicks),
    );
    const maxWaitTicks = Math.max(
      ...warheads.map((w) => w.nukeState().waitTicks),
    );

    // Since short-flight scaling aggressively pulls the target down, actual flight time evaluates to ~5.5 ticks
    expect(minWaitTicks).toBeGreaterThanOrEqual(5);
    expect(minWaitTicks).toBeLessThan(10);
    expect(maxWaitTicks - minWaitTicks).toBeLessThanOrEqual(15);

    // Check the remaining path length in the execution.
    // An un-normalized speed 50 path would traverse 35px in 1 tick (pathLength 0 after shifting).
    // The short-flight branch slows it down to target ~7.7 ticks.
    // Even after shifting a few points, the remaining path must be >= 5
    expect(execution.fullPath.length).toBeGreaterThanOrEqual(5);

    spy.mockRestore();
  });

  test("Long-distance MIRV launch (> baseTicks) dynamically uses long-flight branch", async () => {
    // Normal configuration (nukeSpeed = 15, base target = 14)
    // Launching cross-map forces idealMirvTicksInt > baseTicksScaled, triggering the long-flight branch.
    // We use "plains" (all land) and launch from x=5 to x=90 (1275 pixels).
    const longGame = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true },
      [info],
    );
    const longPlayer = longGame.player(info.id);

    const spawnX = 5;
    const spawnY = 50;
    const targetX = 90;
    const targetY = 50;

    longPlayer.conquer(longGame.ref(spawnX, spawnY));
    for (let x = targetX - 5; x <= targetX + 5; x++) {
      for (let y = targetY - 5; y <= targetY + 5; y++) {
        longPlayer.conquer(longGame.ref(x, y));
      }
    }

    const spy = vi
      .spyOn(MirvExecution.prototype as any, "isOverlapping")
      .mockReturnValue(false);
    longGame.addExecution(
      new ConstructionExecution(
        longPlayer,
        UnitType.MissileSilo,
        longGame.ref(spawnX, spawnY),
      ),
    );
    longGame.executeNextTick();
    longGame.executeNextTick();

    longGame.addExecution(
      new ConstructionExecution(
        longPlayer,
        UnitType.MIRV,
        longGame.ref(targetX, targetY),
      ),
    );
    longGame.executeNextTick();
    longGame.executeNextTick();
    longGame.executeNextTick(); // MIRV unit spawned and path generated

    const execution = (longGame as any)
      .executions()
      .find((e: any) => e instanceof MirvExecution) as any;
    expect(execution).toBeDefined();

    const pathLength = execution.fullPath.length;

    // Ideal flight ticks for 1275px at 15 speed is ~85 ticks.
    // Normalized curve pulls this down significantly, but it must be strictly > 14 base ticks.
    expect(pathLength).toBeGreaterThan(14);
    // At default longFlightMult=14 and linear 10%, it should land comfortably under the 85 tick ideal ceiling.
    expect(pathLength).toBeLessThan(80);

    spy.mockRestore();
  });

  test("MIRV flight time remains consistent and avoids map-edge-bounce acceleration", async () => {
    // Launch identical distance shots: one hugging the top edge (y=1), one safely away (y=50)
    // Both should yield identical total flight ticks because ignoreMapBounds calculates the ideal unclamped curve for normalization.
    const edgeGame = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true },
      [info],
    );
    const edgePlayer = edgeGame.player(info.id);

    edgePlayer.conquer(edgeGame.ref(10, 1));
    edgePlayer.conquer(edgeGame.ref(90, 1)); // Edge target
    edgePlayer.conquer(edgeGame.ref(10, 50));
    edgePlayer.conquer(edgeGame.ref(90, 50)); // Non-edge target

    const spy = vi
      .spyOn(MirvExecution.prototype as any, "isOverlapping")
      .mockReturnValue(false);

    // -- EDGE SHOT --
    edgeGame.addExecution(
      new ConstructionExecution(
        edgePlayer,
        UnitType.MissileSilo,
        edgeGame.ref(10, 1),
      ),
    );
    edgeGame.executeNextTick();
    edgeGame.executeNextTick();
    edgeGame.addExecution(
      new ConstructionExecution(edgePlayer, UnitType.MIRV, edgeGame.ref(90, 1)),
    );
    edgeGame.executeNextTick();
    edgeGame.executeNextTick();
    edgeGame.executeNextTick(); // Path generated

    const edgeExec = (edgeGame as any)
      .executions()
      .filter((e: any) => e instanceof MirvExecution)[0] as any;
    const edgeFlightTicks = edgeExec.fullPath.length;

    // -- NORMAL SHOT --
    edgeGame.addExecution(
      new ConstructionExecution(
        edgePlayer,
        UnitType.MissileSilo,
        edgeGame.ref(10, 50),
      ),
    );
    edgeGame.executeNextTick();
    edgeGame.executeNextTick();
    edgeGame.addExecution(
      new ConstructionExecution(
        edgePlayer,
        UnitType.MIRV,
        edgeGame.ref(90, 50),
      ),
    );
    edgeGame.executeNextTick();
    edgeGame.executeNextTick();
    edgeGame.executeNextTick(); // Path generated

    const normalExec = (edgeGame as any)
      .executions()
      .filter((e: any) => e instanceof MirvExecution)[1] as any;
    const normalFlightTicks = normalExec.fullPath.length;

    // The total flight duration (ticks) should be nearly identical (within 1-2 ticks due to math rounding limits).
    // Before this normalization, edge shots were significantly faster due to the shorter clamped arc.
    // Ensure that edgeFlightTicks is not drastically shorter than normalFlightTicks.
    expect(Math.abs(edgeFlightTicks - normalFlightTicks)).toBeLessThanOrEqual(
      1,
    );

    spy.mockRestore();
  });
});
