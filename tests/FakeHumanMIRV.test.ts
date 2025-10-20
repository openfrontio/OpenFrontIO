import { FakeHumanExecution } from "../src/core/execution/FakeHumanExecution";
import { MirvExecution } from "../src/core/execution/MIRVExecution";
import {
  Cell,
  GameMode,
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

    // Try different game IDs to find one that passes the MIRV failure rate
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

    // Then give dominant player a large amount of territory
    // This should trigger the victory denial threshold
    const totalLandTiles = game.map().numLandTiles();
    const targetTiles = Math.floor(totalLandTiles * 0.66);

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
    expect(dominantTerritoryShare).toBeGreaterThan(0.65);

    // Track MIRVs before fakehuman considers victory denial
    const mirvCountBefore = fakehuman.units(UnitType.MIRV).length;

    // Initialize fakehuman with FakeHumanExecution to enable victory denial logic
    const fakehumanNation = new Nation(new Cell(50, 50), 1, fakehuman.info());

    // Try different game IDs to find one that passes the MIRV failure rate
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

  test("fakehuman launches MIRV to stop steamrolling player with excessive cities", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    // Create three players
    const steamrollerInfo = new PlayerInfo(
      "steamroller",
      PlayerType.Human,
      null,
      "steamroller_id",
    );
    const secondPlayerInfo = new PlayerInfo(
      "second_player",
      PlayerType.Human,
      null,
      "second_id",
    );
    const fakehumanInfo = new PlayerInfo(
      "defender_fakehuman",
      PlayerType.FakeHuman,
      null,
      "fakehuman_id",
    );

    game.addPlayer(steamrollerInfo);
    game.addPlayer(secondPlayerInfo);
    game.addPlayer(fakehumanInfo);

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const steamroller = game.player("steamroller_id");
    const secondPlayer = game.player("second_id");
    const fakehuman = game.player("fakehuman_id");

    // Give fakehuman a small territory and missile silo
    for (let x = 45; x < 55; x++) {
      for (let y = 45; y < 55; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          fakehuman.conquer(tile);
        }
      }
    }
    const fakehumanTile = Array.from(fakehuman.tiles())[0];
    if (fakehumanTile) {
      fakehuman.buildUnit(UnitType.MissileSilo, fakehumanTile, {});
    }

    // Give second player some territory and cities
    for (let x = 20; x < 30; x++) {
      for (let y = 20; y < 30; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          secondPlayer.conquer(tile);
        }
      }
    }
    // Give second player 5 cities
    for (let i = 0; i < 5; i++) {
      const secondPlayerTile = Array.from(secondPlayer.tiles())[0];
      if (secondPlayerTile) {
        secondPlayer.buildUnit(UnitType.City, secondPlayerTile, {});
      }
    }

    // Give steamroller territory and many cities
    for (let x = 5; x < 25; x++) {
      for (let y = 5; y < 25; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          steamroller.conquer(tile);
        }
      }
    }
    // Give steamroller cities
    for (let i = 0; i < 9; i++) {
      const steamrollerTile = Array.from(steamroller.tiles())[0];
      if (steamrollerTile) {
        steamroller.buildUnit(UnitType.City, steamrollerTile, {});
      }
    }

    // Give all players enough gold for MIRVs
    steamroller.addGold(100_000_000n);
    secondPlayer.addGold(100_000_000n);
    fakehuman.addGold(100_000_000n);

    // Verify preconditions
    expect(fakehuman.units(UnitType.MissileSilo)).toHaveLength(1);
    expect(steamroller.unitCount(UnitType.City)).toBe(9);
    expect(secondPlayer.unitCount(UnitType.City)).toBe(5);
    expect(fakehuman.units(UnitType.MIRV)).toHaveLength(0);

    // Track MIRVs before fakehuman considers steamroll stop
    const mirvCountBefore = fakehuman.units(UnitType.MIRV).length;

    // Initialize fakehuman with FakeHumanExecution to enable steamroll stop logic
    const fakehumanNation = new Nation(new Cell(50, 50), 1, fakehuman.info());

    // Try different game IDs to find one that passes the MIRV failure rate
    const gameIds = Array.from({ length: 20 }, (_, i) => `game_${i}`);
    let steamrollStopSuccessful = false;

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
          steamrollStopSuccessful = true;
          break;
        }
      }

      if (steamrollStopSuccessful) break;
    }

    // Assert that steamroll stop was successful
    expect(steamrollStopSuccessful).toBe(true);

    // Process the steamroll stop MIRV
    executeTicks(game, 2);

    // Assert: Fakehuman launched a steamroll stop MIRV
    const mirvCountAfter = fakehuman.units(UnitType.MIRV).length;
    expect(mirvCountAfter).toBeGreaterThan(mirvCountBefore);

    // Verify the steamroll stop MIRV targets the steamroller's territory
    const fakehumanMirvs = fakehuman.units(UnitType.MIRV);
    expect(fakehumanMirvs.length).toBeGreaterThan(0);

    const steamrollStopMirv = fakehumanMirvs[fakehumanMirvs.length - 1];
    const steamrollStopTarget = steamrollStopMirv.targetTile();
    expect(steamrollStopTarget).toBeDefined();

    if (steamrollStopTarget) {
      const targetOwner = game.owner(steamrollStopTarget);
      expect(targetOwner).toBe(steamroller);
    }
  });

  test("fakehuman launches MIRV to prevent team victory when team approaches victory denial threshold (targets biggest team member)", async () => {
    // Setup game
    const teamPlayer1Info = new PlayerInfo(
      "[ALPHA]team_player_1",
      PlayerType.Human,
      null,
      "team1_id",
    );
    const teamPlayer2Info = new PlayerInfo(
      "[ALPHA]team_player_2",
      PlayerType.Human,
      null,
      "team2_id",
    );
    const fakehumanInfo = new PlayerInfo(
      "defender_fakehuman",
      PlayerType.FakeHuman,
      null,
      "fakehuman_id",
    );
    const game = await setup(
      "big_plains",
      {
        infiniteGold: true,
        instantBuild: true,
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [teamPlayer1Info, teamPlayer2Info, fakehumanInfo],
    );

    // Players already added via setup() with Team mode and shared clan for humans

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const teamPlayer1 = game.player("team1_id");
    const teamPlayer2 = game.player("team2_id");
    const fakehuman = game.player("fakehuman_id");

    // Give fakehuman a small territory and missile silo
    for (let x = 45; x < 55; x++) {
      for (let y = 45; y < 55; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          fakehuman.conquer(tile);
        }
      }
    }
    const fakehumanTile = Array.from(fakehuman.tiles())[0];
    if (fakehumanTile) {
      fakehuman.buildUnit(UnitType.MissileSilo, fakehumanTile, {});
    }

    // Give team players a large amount of territory to exceed team threshold,
    // but skew so teamPlayer1 is clearly the largest member
    const totalLandTiles = game.map().numLandTiles();
    const teamTargetTiles = Math.floor(totalLandTiles * 0.82);

    let conqueredTiles = 0;
    for (
      let x = 0;
      x < game.map().width() && conqueredTiles < teamTargetTiles;
      x++
    ) {
      for (
        let y = 0;
        y < game.map().height() && conqueredTiles < teamTargetTiles;
        y++
      ) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.map().hasOwner(tile)) {
          // 3:1 bias towards teamPlayer1 to ensure largest-member targeting is well-defined
          const teamPlayer =
            conqueredTiles % 4 === 0 ? teamPlayer2 : teamPlayer1;
          teamPlayer.conquer(tile);
          conqueredTiles++;
        }
      }
    }

    // Give all players enough gold for MIRVs
    teamPlayer1.addGold(100_000_000n);
    teamPlayer2.addGold(100_000_000n);
    fakehuman.addGold(100_000_000n);

    // Verify preconditions
    expect(fakehuman.units(UnitType.MissileSilo)).toHaveLength(1);
    expect(fakehuman.units(UnitType.MIRV)).toHaveLength(0);
    expect(teamPlayer1.gold()).toBeGreaterThan(35_000_000n);
    expect(teamPlayer2.gold()).toBeGreaterThan(35_000_000n);
    expect(fakehuman.gold()).toBeGreaterThan(35_000_000n);
    expect(fakehuman.isAlive()).toBe(true);
    expect(fakehuman.numTilesOwned()).toBeGreaterThan(0);

    // Verify team has enough territory to trigger team victory denial
    const teamTerritory =
      teamPlayer1.numTilesOwned() + teamPlayer2.numTilesOwned();
    const teamShare = teamTerritory / game.map().numLandTiles();
    expect(teamShare).toBeGreaterThan(0.8); //

    // Track MIRVs before fakehuman considers team victory denial
    const mirvCountBefore = fakehuman.units(UnitType.MIRV).length;

    // Initialize fakehuman with FakeHumanExecution to enable team victory denial logic
    const fakehumanNation = new Nation(new Cell(50, 50), 1, fakehuman.info());

    // Try different game IDs to find one that passes the MIRV failure rate
    const gameIds = Array.from({ length: 20 }, (_, i) => `game_${i}`);
    let teamVictoryDenialSuccessful = false;

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
          teamVictoryDenialSuccessful = true;
          break;
        }
      }

      if (teamVictoryDenialSuccessful) break;
    }

    // Assert that team victory denial was successful
    expect(teamVictoryDenialSuccessful).toBe(true);

    // Process the team victory denial MIRV
    executeTicks(game, 2);

    // Assert: Fakehuman launched a team victory denial MIRV
    const mirvCountAfter = fakehuman.units(UnitType.MIRV).length;
    expect(mirvCountAfter).toBeGreaterThan(mirvCountBefore);

    // Verify the team victory denial MIRV targets the largest member of the team
    const fakehumanMirvs = fakehuman.units(UnitType.MIRV);
    expect(fakehumanMirvs.length).toBeGreaterThan(0);

    const teamVictoryDenialMirv = fakehumanMirvs[fakehumanMirvs.length - 1];
    const teamVictoryDenialTarget = teamVictoryDenialMirv.targetTile();
    expect(teamVictoryDenialTarget).toBeDefined();

    if (teamVictoryDenialTarget) {
      const targetOwner = game.owner(teamVictoryDenialTarget);
      // Should target the biggest member of the team
      const biggest =
        teamPlayer1.numTilesOwned() >= teamPlayer2.numTilesOwned()
          ? teamPlayer1
          : teamPlayer2;
      expect(targetOwner).toBe(biggest);
    }
  });
});
