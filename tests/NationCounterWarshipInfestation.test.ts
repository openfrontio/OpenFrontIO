import { NationExecution } from "../src/core/execution/NationExecution";
import {
  Cell,
  Difficulty,
  GameMode,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

// The half_land_half_ocean map is 16x16:
// - x=0-7 is land
// - x=8-15 is ocean
// Coast is at x=7

describe("Counter Warship Infestation", () => {
  test("rich nation sends counter-warship in FFA when enemy has too many warships", async () => {
    const game = await setup("half_land_half_ocean", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Hard, // Required for counter-warship logic
    });

    // Create players: a rich nation and an enemy with many warships
    const nationInfo = new PlayerInfo(
      "defender_nation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const enemyInfo = new PlayerInfo(
      "warship_spammer",
      PlayerType.Human,
      null,
      "enemy_id",
    );

    game.addPlayer(nationInfo);
    game.addPlayer(enemyInfo);

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const nation = game.player("nation_id");
    const enemy = game.player("enemy_id");

    // Give nation territory on land (x=0-6, y=0-7)
    for (let x = 0; x < 7; x++) {
      for (let y = 0; y < 8; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          nation.conquer(tile);
        }
      }
    }

    // Give enemy territory on land (x=0-6, y=8-15)
    for (let x = 0; x < 7; x++) {
      for (let y = 8; y < 16; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          enemy.conquer(tile);
        }
      }
    }

    // Build a port for the nation on the coast (x=7 is ocean shore)
    // Need to find an ocean shore tile in nation's territory
    const coastTile = game.ref(6, 4); // Should be land next to ocean
    nation.buildUnit(UnitType.Port, coastTile, {});

    // Give nation plenty of gold to be one of the richest
    nation.addGold(10_000_000_000n);

    // Build 11+ warships for the enemy on ocean tiles (x=8-15)
    // Each warship needs a unique ocean tile
    for (let i = 0; i < 12; i++) {
      const oceanX = 8 + (i % 8);
      const oceanY = i < 8 ? 4 : 12;
      const oceanTile = game.ref(oceanX, oceanY);
      if (game.map().isOcean(oceanTile)) {
        enemy.buildUnit(UnitType.Warship, oceanTile, {
          patrolTile: oceanTile,
        });
      }
    }

    // Verify preconditions
    expect(nation.units(UnitType.Port)).toHaveLength(1);
    expect(enemy.units(UnitType.Warship).length).toBeGreaterThan(10);
    expect(game.unitCount(UnitType.Warship)).toBeGreaterThan(10);
    expect(nation.gold()).toBeGreaterThan(0n);
    expect(game.inSpawnPhase()).toBe(false);
    expect(nation.isAlive()).toBe(true);

    // Track warships before nation counters
    const warshipCountBefore = nation.units(UnitType.Warship).length;

    // Initialize nation with NationExecution to enable counter-warship logic
    const testExecutionNation = new Nation(new Cell(3, 4), nation.info());

    // Try different game IDs to account for randomness in attackRate/attackTick
    const gameIds = Array.from({ length: 50 }, (_, i) => `game_ffa_${i}`);
    let counterWarshipBuilt = false;

    for (const gameId of gameIds) {
      const testExecution = new NationExecution(gameId, testExecutionNation);
      testExecution.init(game);

      // Execute nation's tick logic - run many ticks to ensure we hit the attackRate/attackTick timing
      // attackRate is 40-80, so we need to run at least 160 ticks (2 cycles) to ensure we hit it twice
      // (first hit initializes behaviors, second hit runs counterWarshipInfestation)
      for (let tick = 0; tick < 300; tick++) {
        testExecution.tick(tick);
        // Allow the game to process executions periodically
        game.executeNextTick();

        // Check if nation built a counter-warship
        if (nation.units(UnitType.Warship).length > warshipCountBefore) {
          counterWarshipBuilt = true;
          break;
        }
      }

      if (counterWarshipBuilt) break;
    }

    // Assert that counter-warship was built
    expect(counterWarshipBuilt).toBe(true);

    // Verify nation now has a warship
    expect(nation.units(UnitType.Warship).length).toBeGreaterThan(
      warshipCountBefore,
    );
  });

  test("rich nation sends counter-warship in Team game when enemy team has too many warships", async () => {
    // Create players with team setup - use clan tags to group players
    const nationInfo = new PlayerInfo(
      "[ALPHA]defender_nation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const allyInfo = new PlayerInfo(
      "[ALPHA]ally_player",
      PlayerType.Human,
      null,
      "ally_id",
    );
    const enemy1Info = new PlayerInfo(
      "[BETA]enemy_player_1",
      PlayerType.Human,
      null,
      "enemy1_id",
    );
    const enemy2Info = new PlayerInfo(
      "[BETA]enemy_player_2",
      PlayerType.Human,
      null,
      "enemy2_id",
    );

    const game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
        difficulty: Difficulty.Hard, // Required for counter-warship logic
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [nationInfo, allyInfo, enemy1Info, enemy2Info],
    );

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const nation = game.player("nation_id");
    const ally = game.player("ally_id");
    const enemy1 = game.player("enemy1_id");
    const enemy2 = game.player("enemy2_id");

    // Verify team setup
    expect(nation.team()).not.toBeNull();
    expect(nation.isOnSameTeam(ally)).toBe(true);
    expect(nation.isOnSameTeam(enemy1)).toBe(false);
    expect(enemy1.isOnSameTeam(enemy2)).toBe(true);

    // Give nation territory on land (x=0-3, y=0-7)
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 8; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          nation.conquer(tile);
        }
      }
    }

    // Give ally territory on land (x=4-6, y=0-7)
    for (let x = 4; x < 7; x++) {
      for (let y = 0; y < 8; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          ally.conquer(tile);
        }
      }
    }

    // Give enemies territory on land (x=0-6, y=8-15)
    for (let x = 0; x < 4; x++) {
      for (let y = 8; y < 16; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          enemy1.conquer(tile);
        }
      }
    }
    for (let x = 4; x < 7; x++) {
      for (let y = 8; y < 16; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          enemy2.conquer(tile);
        }
      }
    }

    // Build a port for the nation on the coast
    const coastTile = game.ref(3, 4);
    nation.buildUnit(UnitType.Port, coastTile, {});

    // Give nation plenty of gold to be one of the richest
    nation.addGold(10_000_000_000n);

    // Build warships for enemy team on ocean tiles: total > 15 to trigger team threshold
    // Enemy1 gets 10 warships (more than 3, which is required for targeting)
    for (let i = 0; i < 10; i++) {
      const oceanX = 8 + (i % 8);
      const oceanY = 2 + Math.floor(i / 8);
      const oceanTile = game.ref(oceanX, oceanY);
      if (game.map().isOcean(oceanTile)) {
        enemy1.buildUnit(UnitType.Warship, oceanTile, {
          patrolTile: oceanTile,
        });
      }
    }
    // Enemy2 gets 6 warships (so total = 16 > 15)
    for (let i = 0; i < 6; i++) {
      const oceanX = 8 + i;
      const oceanY = 10;
      const oceanTile = game.ref(oceanX, oceanY);
      if (game.map().isOcean(oceanTile)) {
        enemy2.buildUnit(UnitType.Warship, oceanTile, {
          patrolTile: oceanTile,
        });
      }
    }

    // Verify preconditions
    expect(nation.units(UnitType.Port)).toHaveLength(1);
    expect(enemy1.units(UnitType.Warship).length).toBe(10);
    expect(enemy2.units(UnitType.Warship).length).toBe(6);
    const totalEnemyTeamWarships =
      enemy1.units(UnitType.Warship).length +
      enemy2.units(UnitType.Warship).length;
    expect(totalEnemyTeamWarships).toBeGreaterThan(15);
    expect(game.unitCount(UnitType.Warship)).toBeGreaterThan(10);
    expect(nation.gold()).toBeGreaterThan(0n);
    expect(game.inSpawnPhase()).toBe(false);
    expect(nation.isAlive()).toBe(true);

    // Track warships before nation counters
    const warshipCountBefore = nation.units(UnitType.Warship).length;

    // Initialize nation with NationExecution to enable counter-warship logic
    const testExecutionNation = new Nation(new Cell(2, 4), nation.info());

    // Try different game IDs to account for randomness in attackRate/attackTick
    const gameIds = Array.from({ length: 50 }, (_, i) => `game_team_${i}`);
    let counterWarshipBuilt = false;

    for (const gameId of gameIds) {
      const testExecution = new NationExecution(gameId, testExecutionNation);
      testExecution.init(game);

      // Execute nation's tick logic - run many ticks to ensure we hit the attackRate/attackTick timing
      // attackRate is 40-80, so we need to run at least 160 ticks (2 cycles) to ensure we hit it twice
      // (first hit initializes behaviors, second hit runs counterWarshipInfestation)
      for (let tick = 0; tick < 300; tick++) {
        testExecution.tick(tick);
        // Allow the game to process executions periodically
        game.executeNextTick();

        // Check if nation built a counter-warship
        if (nation.units(UnitType.Warship).length > warshipCountBefore) {
          counterWarshipBuilt = true;
          break;
        }
      }

      if (counterWarshipBuilt) break;
    }

    // Assert that counter-warship was built
    expect(counterWarshipBuilt).toBe(true);

    // Verify nation now has a warship
    expect(nation.units(UnitType.Warship).length).toBeGreaterThan(
      warshipCountBefore,
    );
  });
});
