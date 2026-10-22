import {
  MessageType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import {
  MirvExecution,
  MirvExecutionSnapshot,
} from "@openfront/engine/execution/MIRVExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("MIRVExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

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
    expect(callArgs[1]).toBe("events_display.mirv_inbound");
    expect(callArgs[2]).toBe(MessageType.MIRV_INBOUND);
    expect(callArgs[3]).toBe(otherPlayer.id());
  });

  test("MIRV should use the current destination owner at launch", () => {
    const targetTile = game.ref(20, 20);
    expect(game.owner(targetTile).isPlayer()).toBe(false);
    const allianceRequest = player.createAllianceRequest(otherPlayer);
    allianceRequest!.accept();
    const playerRelationSpy = vi.spyOn(player, "updateRelation");
    const otherPlayerRelationSpy = vi.spyOn(otherPlayer, "updateRelation");
    const bombLaunchSpy = vi.spyOn(game.stats(), "bombLaunch");
    vi.spyOn(player, "canBuild").mockReturnValue(game.ref(10, 10));
    const displaySpy = vi.spyOn(game, "displayIncomingUnit");
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 1);
    otherPlayer.conquer(targetTile);
    executeTicks(game, 1);

    const mirv = player.units(UnitType.MIRV);
    expect(mirv).toHaveLength(1);
    expect(mirv[0]?.targetPlayer()).toBe(otherPlayer);
    expect(bombLaunchSpy).toHaveBeenCalledWith(
      player,
      otherPlayer,
      UnitType.MIRV,
    );
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
    expect(player.isTraitor()).toBe(true);
    expect(playerRelationSpy).toHaveBeenCalledWith(otherPlayer, -100);
    expect(otherPlayerRelationSpy).toHaveBeenCalledWith(player, -100);
    expect(displaySpy).toHaveBeenCalledTimes(1);
    expect(displaySpy.mock.calls[0][3]).toBe(otherPlayer.id());
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

  test("MIRV should not notify terra nullius after a successful build", () => {
    const targetTile = game.ref(20, 20);
    expect(game.owner(targetTile).isPlayer()).toBe(false);
    vi.spyOn(player, "canBuild").mockReturnValue(game.ref(10, 10));
    const displaySpy = vi.spyOn(game, "displayIncomingUnit");
    const mirvExec = new MirvExecution(player, targetTile);
    mirvExec.init(game, game.ticks());
    mirvExec.tick(game.ticks());
    expect(player.units(UnitType.MIRV)).toHaveLength(1);
    expect(displaySpy).not.toHaveBeenCalled();
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

  // Scenario 1: Spatial Hash Mathematical Correctness
  test("Spatial Hash Mathematical Correctness (Overlap bounds)", async () => {
    const targetTile = game.ref(110, 110);
    if (game.map().isLand(targetTile)) {
      otherPlayer.conquer(targetTile);
    }
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);
    executeTicks(game, 2);

    // Make mirvExec accessible for internal method testing
    const exec = mirvExec as any;
    exec.spatialGrid = new Int32Array(exec.gridWidth * exec.gridWidth * 2);
    exec.spatialGrid.fill(-1);
    const tCenter = game.ref(100, 100);
    exec.addToGrid(exec.spatialGrid, tCenter);

    // 54 distance = overlap (returns true)
    // 55 distance = no overlap (returns false)
    expect(exec.isOverlapping(100 + 54, 100)).toBe(true);
    expect(exec.isOverlapping(100 + 55, 100)).toBe(false);
    expect(exec.isOverlapping(100 - 54, 100)).toBe(true);
    expect(exec.isOverlapping(100 - 55, 100)).toBe(false);
    expect(exec.isOverlapping(100, 100 + 54)).toBe(true);
    expect(exec.isOverlapping(100, 100 + 55)).toBe(false);
    expect(exec.isOverlapping(100, 100 - 54)).toBe(true);
    expect(exec.isOverlapping(100, 100 - 55)).toBe(false);
    // Diagonal 54
    expect(exec.isOverlapping(100 + 27, 100 + 27)).toBe(true);
    // Diagonal 55
    expect(exec.isOverlapping(100 + 28, 100 + 27)).toBe(false);
  });

  // Scenario 2: Crowded Territory Saturation Cutoff
  test("Crowded Territory Saturation Cutoff", async () => {
    // Give other player ALL land on the map, EXCEPT player's own tiles
    for (let x = 0; x < game.map().width(); x++) {
      for (let y = 0; y < game.map().height(); y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && game.owner(tile) !== player) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(100, 100);
    const mirvExec = new MirvExecution(player, targetTile);
    const exec = mirvExec as any;
    exec.range = 100;
    exec.rangeSquared = 10000;
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // Fast forward to tick 20 where target generation starts
    // exec is already defined above
    while (exec.fullPath.length - exec.pathIndex > 20) {
      game.executeNextTick();
    }

    // Measure time to ensure it does not spinlock
    const start = performance.now();

    // Execute through target generation phase
    while (exec.fullPath.length - exec.pathIndex > 10) {
      game.executeNextTick();
    }

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);

    // Wait until warheads spawn
    while (!exec.warheadsSpawned) {
      game.executeNextTick();
    }

    // Saturation threshold must have been hit
    expect(exec.consecutiveOverlapFailures).toBeGreaterThanOrEqual(1500);
  });

  // Scenario 3: Small Island / Fragmented Territory Capacity
  test("Small Island / Fragmented Territory Capacity", async () => {
    // Clear other player territory
    for (let x = 0; x < game.map().width(); x++) {
      for (let y = 0; y < game.map().height(); y++) {
        const tile = game.ref(x, y);
        if (game.owner(tile) === otherPlayer) {
          otherPlayer.relinquish(tile);
        }
      }
    }

    // Give other player a 100x100 island surrounded by ocean
    let conquered = 0;
    for (let x = 100; x < 199; x++) {
      for (let y = 100; y < 199; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          otherPlayer.conquer(tile);
          conquered++;
        }
      }
    }
    expect(conquered).toBeGreaterThan(0);

    const targetTile = game.ref(150, 150);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    const exec = mirvExec as any;
    while (!exec.warheadsSpawned) {
      game.executeNextTick();
    }

    // A 100x100 territory is small (not huge, which would be 1000x1000) and packs at most ~7 targets with spread 55.
    // Clamped candidate coordinate generation packs targets to capacity without premature cutoff on misses.
    expect(exec.stagedTargets.length).toBeGreaterThanOrEqual(7);
  });

  // Scenario 4: Mid-Flight Snapshot Determinism
  test("Mid-Flight Snapshot Determinism", async () => {
    const targetTile = game.ref(150, 150);
    if (game.map().isLand(targetTile)) {
      otherPlayer.conquer(targetTile);
    }
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    const exec = mirvExec as any;
    // Execute until remainingTicks = 15
    while (exec.fullPath.length - exec.pathIndex > 15) {
      game.executeNextTick();
    }

    // Save snapshot
    const { roundTrip } = await import("../../util/Snapshot");
    const { restored: game2 } = await roundTrip(game, "big_plains");

    // Advance both to tick 0 (until MIRV explodes)
    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    const mirvExec2 = (
      (game2 as any).executions?.() ?? (game2 as any).execs
    ).find((e: any) => e.constructor.name === "MirvExecution");
    while (mirvExec2 && mirvExec2.isActive()) {
      game2.executeNextTick();
    }

    const exec2 = mirvExec2 as any;
    // Verify staged targets match
    expect(exec.stagedTargets).toEqual(exec2.stagedTargets);

    // Verify warhead destinations match identically
    const warheads1 = exec.warheadExecutions.map((e: any) => e.dst);
    const warheads2 = exec2.warheadExecutions.map((e: any) => e.dst);
    expect(warheads1).toEqual(warheads2);
  });

  test("Uninitialized MirvExecution Snapshot Round-Trip", async () => {
    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    // Snapshot before executeNextTick() runs MirvExecution.init()
    const { expectSnapshotRoundTrip } = await import("../../util/Snapshot");
    await expectSnapshotRoundTrip(game, "big_plains", 5);
  });

  // Scenario 5: Territory Capture Replenishment
  test("Territory Capture Replenishment", async () => {
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
    const exec = mirvExec as any;

    while (exec.fullPath.length - exec.pathIndex > 10) {
      game.executeNextTick();
    }

    // Artificially max out saturation to simulate reaching threshold
    exec.consecutiveOverlapFailures = 1500;

    // Now simulate frontline loss at tick 10: player conquers some of the targeted tiles!
    const targetsToLose = exec.stagedTargets
      .filter((t: any) => t !== exec.dst)
      .slice(0, 5);
    for (const tile of targetsToLose) {
      otherPlayer.relinquish(tile);
      player.conquer(tile);
    }

    // Execute tick 10 (finalizeDestinations)
    game.executeNextTick();

    // The lost targets should be purged, consecutive failures reset to 0, and top-up attempted.
    // With clamped coordinate generation, top-up replenishes targets back to capacity.
    expect(exec.stagedTargets.length).toBeGreaterThanOrEqual(7);
    for (const t of targetsToLose) {
      expect(exec.stagedTargets.includes(t)).toBe(false);
    }

    // Verify the lost targets are no longer in the spatialGrid
    let foundInGrid = false;
    for (let i = 0; i < exec.spatialGrid.length; i++) {
      const tile = exec.spatialGrid[i];
      if (tile !== -1 && targetsToLose.includes(tile)) {
        foundInGrid = true;
      }
    }
    expect(foundInGrid).toBe(false);
  });

  test("removeFromGrid maintains slot invariant", async () => {
    const targetTile = game.ref(110, 110);
    if (game.map().isLand(targetTile)) {
      otherPlayer.conquer(targetTile);
    }
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);
    executeTicks(game, 2);

    const exec = mirvExec as any;
    const tile1 = game.ref(100, 100);
    const tile2 = game.ref(100, 101);

    exec.spatialGrid = new Int32Array(exec.gridWidth * exec.gridWidth * 2);
    exec.spatialGrid.fill(-1);

    exec.addToGrid(exec.spatialGrid, tile1);
    exec.addToGrid(exec.spatialGrid, tile2);

    const cx = Math.floor(
      (game.x(tile1) - exec.baseX + exec.range) / exec.minimumSpread,
    );
    const cy = Math.floor(
      (game.y(tile1) - exec.baseY + exec.range) / exec.minimumSpread,
    );
    const offset = (cy * exec.gridWidth + cx) * 2;

    expect(exec.spatialGrid[offset]).toBe(tile1);
    expect(exec.spatialGrid[offset + 1]).toBe(tile2);

    // Removing slot 0 shifts slot 1 to slot 0
    exec.removeFromGrid(tile1);
    expect(exec.spatialGrid[offset]).toBe(tile2);
    expect(exec.spatialGrid[offset + 1]).toBe(-1);

    // Removing remaining slot 0 clears it
    exec.removeFromGrid(tile2);
    expect(exec.spatialGrid[offset]).toBe(-1);
    expect(exec.spatialGrid[offset + 1]).toBe(-1);
  });

  test("MirvExecutionSnapshot migrates v1 snapshot without consecutiveOverlapFailures", () => {
    const v1Data = {
      active: true,
      player: 1,
      dst: 100,
      range: 1500,
      rangeSquared: 2250000,
      minimumSpread: 55,
      warheadCount: 350,
      init: null,
      nuke: null,
      launch: null,
      speed: 1,
      fullPath: new Uint32Array([100]),
      pathIndex: 0,
      stagedTargets: new Uint32Array([100]),
      warheadsSpawned: false,
      warheadExecutions: [],
    };
    const migrated = readVersioned(MirvExecutionSnapshot, {
      v: 1,
      d: v1Data,
    });
    expect(migrated.consecutiveOverlapFailures).toBe(0);
  });

  test("MirvExecution migrates and restores in-flight v1 snapshot across full game lifecycle", async () => {
    const targetTile = game.ref(150, 150);
    if (game.map().isLand(targetTile)) {
      otherPlayer.conquer(targetTile);
    }
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);
    executeTicks(game, 2);

    const { snapshotGame } =
      await import("@openfront/engine/snapshot/GameSnapshot");
    const { decodeSnapshotValue, encodeSnapshotValue } =
      await import("@openfront/engine/snapshot/SnapshotCodec");
    const { restoreTestGame } = await import("../../util/Snapshot");

    // Take snapshot and downgrade MIRV execution record to v1
    const bytes = snapshotGame(game);
    const root = decodeSnapshotValue(bytes) as any;
    const mirvRec = root.execs.find((e: any) => e.t === "MIRV");
    expect(mirvRec).toBeDefined();
    expect(mirvRec.v).toBe(2);
    expect(mirvRec.d.consecutiveOverlapFailures).toBeDefined();

    // Downgrade record to v1 layout
    mirvRec.v = 1;
    delete mirvRec.d.consecutiveOverlapFailures;

    // Restore game from the v1 MIRV snapshot bytes
    const v1Bytes = encodeSnapshotValue(root);
    const restoredGame = await restoreTestGame(v1Bytes, "big_plains");

    const restoredMirv = (
      (restoredGame as any).executions?.() ?? (restoredGame as any).execs
    ).find((e: any) => e.constructor.name === "MirvExecution") as any;

    expect(restoredMirv).toBeDefined();
    expect(restoredMirv.consecutiveOverlapFailures).toBe(0);

    // Advance both to ensure simulation progresses to completion without divergence or errors
    while (mirvExec.isActive()) {
      game.executeNextTick();
    }
    while (restoredMirv.isActive()) {
      restoredGame.executeNextTick();
    }
  });
});
