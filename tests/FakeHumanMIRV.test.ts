import { FakeHumanExecution } from "../src/core/execution/FakeHumanExecution";
import { MirvExecution } from "../src/core/execution/MIRVExecution";
import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("FakeHuman MIRV Retaliation", () => {
  test("fakehuman retaliates with MIRV when attacked by MIRV", async () => {
    const game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    // Create two players
    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const fakehumanInfo = new PlayerInfo(
      "defender_fakehuman",
      PlayerType.FakeHuman,
      null,
      "fakehuman_id",
    );

    game.addPlayer(attackerInfo);
    game.addPlayer(fakehumanInfo);

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const attacker = game.player("attacker_id");
    const fakehuman = game.player("fakehuman_id");

    // Give attacker territory and missile silo
    for (let x = 5; x < 15; x++) {
      for (let y = 5; y < 15; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          attacker.conquer(tile);
        }
      }
    }
    attacker.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});

    // Give fakehuman territory and missile silo
    for (let x = 45; x < 55; x++) {
      for (let y = 45; y < 55; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) {
          fakehuman.conquer(tile);
        }
      }
    }
    fakehuman.buildUnit(UnitType.MissileSilo, game.ref(50, 50), {});

    // Give both players enough gold for MIRVs
    attacker.addGold(100_000_000n);
    fakehuman.addGold(100_000_000n);

    // Verify preconditions
    expect(attacker.units(UnitType.MissileSilo)).toHaveLength(1);
    expect(fakehuman.units(UnitType.MissileSilo)).toHaveLength(1);
    expect(attacker.gold()).toBeGreaterThan(35_000_000n);
    expect(fakehuman.gold()).toBeGreaterThan(35_000_000n);

    // Attacker launches a MIRV at the fakehuman
    const targetTile = Array.from(fakehuman.tiles())[0];
    game.addExecution(new MirvExecution(attacker, targetTile));

    // Execute a few ticks so the MIRV is in flight
    executeTicks(game, 5);

    // Verify attacker's MIRV is in flight
    expect(attacker.units(UnitType.MIRV).length).toBeGreaterThan(0);

    // Track MIRVs before fakehuman retaliates
    const mirvCountBefore = fakehuman.units(UnitType.MIRV).length;

    // Initialize fakehuman with FakeHumanExecution to enable retaliation logic
    const fakehumanNation = new Nation(new Cell(50, 50), 1, fakehuman.info());

    // Try different game IDs to find one that passes the 35% MIRV failure rate
    // Since random is seeded, we try multiple seeds to ensure at least one passes
    const gameIds = Array.from({ length: 20 }, (_, i) => `game_${i}`);
    let retaliationSuccessful = false;

    for (const gameId of gameIds) {
      const testExecution = new FakeHumanExecution(gameId, fakehumanNation);
      testExecution.init(game);

      // Execute fakehuman's tick logic - need to run many iterations because:
      // 1. Fakehuman only runs on ticks matching attackRate/attackTick pattern
      // 2. First run initializes behavior, subsequent runs execute MIRV logic
      for (let tick = 0; tick < 200; tick++) {
        testExecution.tick(game.ticks() + tick);
        // Allow the game to process executions
        if (tick % 10 === 0) {
          game.executeNextTick();
        }
        if (fakehuman.units(UnitType.MIRV).length > mirvCountBefore) {
          retaliationSuccessful = true;
          break;
        }
      }

      if (retaliationSuccessful) break;
    }

    // Assert that retaliation was successful
    expect(retaliationSuccessful).toBe(true);

    // Process the retaliation
    executeTicks(game, 2);

    // Assert: Fakehuman launched a retaliatory MIRV
    const mirvCountAfter = fakehuman.units(UnitType.MIRV).length;
    expect(mirvCountAfter).toBeGreaterThan(mirvCountBefore);

    // Verify the retaliatory MIRV targets the attacker's territory
    const fakehumanMirvs = fakehuman.units(UnitType.MIRV);
    expect(fakehumanMirvs.length).toBeGreaterThan(0);

    const retaliationMirv = fakehumanMirvs[fakehumanMirvs.length - 1];
    const retaliationTarget = retaliationMirv.targetTile();
    expect(retaliationTarget).toBeDefined();

    if (retaliationTarget) {
      const targetOwner = game.owner(retaliationTarget);
      expect(targetOwner).toBe(attacker);
    }
  });

  test("fakehuman launches MIRV to prevent victory when player approaches win condition", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    // Create two players
    const dominantPlayerInfo = new PlayerInfo(
      "dominant_player",
      PlayerType.Human,
      null,
      "dominant_id",
    );
    const fakehumanInfo = new PlayerInfo(
      "defender_fakehuman",
      PlayerType.FakeHuman,
      null,
      "fakehuman_id",
    );

    game.addPlayer(dominantPlayerInfo);
    game.addPlayer(fakehumanInfo);

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const dominantPlayer = game.player("dominant_id");
    const fakehuman = game.player("fakehuman_id");

    // First, give fakehuman a small territory and missile silo
    let fakehumanTiles = 0;
    for (let x = 45; x < 55; x++) {
      for (let y = 45; y < 55; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          fakehuman.conquer(tile);
          fakehumanTiles++;
        }
      }
    }

    // If we didn't find enough tiles, try a different area
    if (fakehumanTiles === 0) {
      for (let x = 60; x < 70; x++) {
        for (let y = 60; y < 70; y++) {
          const tile = game.ref(x, y);
          if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
            fakehuman.conquer(tile);
            fakehumanTiles++;
            if (fakehumanTiles >= 10) break; // Need at least some territory
          }
        }
        if (fakehumanTiles >= 10) break;
      }
    }

    // Build missile silo on one of the fakehuman's tiles
    const fakehumanTile = Array.from(fakehuman.tiles())[0];
    if (fakehumanTile) {
      fakehuman.buildUnit(UnitType.MissileSilo, fakehumanTile, {});
    }

    // Then give dominant player a large amount of territory (70%+ of total land)
    // This should trigger the victory denial threshold (70% individual threshold)
    const totalLandTiles = game.map().numLandTiles();
    const targetTiles = Math.floor(totalLandTiles * 0.75); // 75% of land

    let conqueredTiles = 0;
    for (
      let x = 0;
      x < game.map().width() && conqueredTiles < targetTiles;
      x++
    ) {
      for (
        let y = 0;
        y < game.map().height() && conqueredTiles < targetTiles;
        y++
      ) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          dominantPlayer.conquer(tile);
          conqueredTiles++;
        }
      }
    }

    // Give both players enough gold for MIRVs
    dominantPlayer.addGold(100_000_000n);
    fakehuman.addGold(100_000_000n);

    // Verify preconditions
    expect(dominantPlayer.units(UnitType.MissileSilo)).toHaveLength(0);
    expect(fakehuman.units(UnitType.MissileSilo)).toHaveLength(1);
    expect(fakehuman.units(UnitType.MIRV)).toHaveLength(0);
    expect(dominantPlayer.units(UnitType.MIRV)).toHaveLength(0);
    expect(dominantPlayer.gold()).toBeGreaterThan(35_000_000n);
    expect(fakehuman.gold()).toBeGreaterThan(35_000_000n);
    expect(fakehuman.isAlive()).toBe(true);
    expect(fakehuman.numTilesOwned()).toBeGreaterThan(0);

    // Verify dominant player has enough territory to trigger victory denial
    const dominantTerritoryShare =
      dominantPlayer.numTilesOwned() / game.map().numLandTiles();
    expect(dominantTerritoryShare).toBeGreaterThan(0.7); // Above 70% threshold

    // Track MIRVs before fakehuman considers victory denial
    const mirvCountBefore = fakehuman.units(UnitType.MIRV).length;

    // Initialize fakehuman with FakeHumanExecution to enable victory denial logic
    const fakehumanNation = new Nation(new Cell(50, 50), 1, fakehuman.info());

    // Try different game IDs to find one that passes the 35% MIRV failure rate
    const gameIds = Array.from({ length: 20 }, (_, i) => `game_${i}`);
    let victoryDenialSuccessful = false;

    for (const gameId of gameIds) {
      const testExecution = new FakeHumanExecution(gameId, fakehumanNation);
      testExecution.init(game);

      for (let tick = 0; tick < 200; tick++) {
        testExecution.tick(game.ticks() + tick);
        // Allow the game to process executions
        if (tick % 10 === 0) {
          game.executeNextTick();
        }
        if (fakehuman.units(UnitType.MIRV).length > mirvCountBefore) {
          victoryDenialSuccessful = true;
          break;
        }
      }

      if (victoryDenialSuccessful) break;
    }

    // Assert that victory denial was successful
    expect(victoryDenialSuccessful).toBe(true);

    // Process the victory denial MIRV
    executeTicks(game, 2);

    // Assert: Fakehuman launched a victory denial MIRV
    const mirvCountAfter = fakehuman.units(UnitType.MIRV).length;
    expect(mirvCountAfter).toBeGreaterThan(mirvCountBefore);

    // Verify the victory denial MIRV targets the dominant player's territory
    const fakehumanMirvs = fakehuman.units(UnitType.MIRV);
    expect(fakehumanMirvs.length).toBeGreaterThan(0);

    const victoryDenialMirv = fakehumanMirvs[fakehumanMirvs.length - 1];
    const victoryDenialTarget = victoryDenialMirv.targetTile();
    expect(victoryDenialTarget).toBeDefined();

    if (victoryDenialTarget) {
      const targetOwner = game.owner(victoryDenialTarget);
      expect(targetOwner).toBe(dominantPlayer);
    }
  });
});
