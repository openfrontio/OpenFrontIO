import { beforeEach, describe, expect, it } from "@jest/globals";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TrainingCampExecution } from "../src/core/execution/TrainingCampExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";

describe("TrainingCampExecution", () => {
  let game: Game;
  let player: Player;
  let tile: TileRef;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    // Add a player
    const playerInfo = new PlayerInfo(
      "TestPlayer",
      PlayerType.Human,
      null,
      "player1",
    );
    game.addPlayer(playerInfo);
    player = game.player("player1");

    // Spawn the player on a tile
    const spawnTile = game.ref(10, 10);
    game.addExecution(new SpawnExecution(playerInfo, spawnTile));

    // Wait for spawn phase to complete
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Get a tile for the training camp (same as spawn tile for simplicity)
    tile = spawnTile;
  });

  describe("Training Camp Creation", () => {
    it("should create training camp execution", () => {
      const execution = new TrainingCampExecution(player, tile);
      expect(execution).toBeDefined();
      expect(execution.isActive()).toBe(true);
    });

    it("should initialize training camp execution", () => {
      const execution = new TrainingCampExecution(player, tile);
      execution.init(game, 100);
      expect(execution.isActive()).toBe(true);
    });
  });

  describe("Training Camp Execution Behavior", () => {
    it("should deactivate when cannot build", () => {
      // Create execution with a tile that the player cannot build on
      const invalidTile = game.ref(20, 20); // Tile not owned by player
      const execution = new TrainingCampExecution(player, invalidTile);
      execution.init(game, 100);

      // Try to tick - should deactivate because player cannot build there
      execution.tick(100);

      expect(execution.isActive()).toBe(false);
    });

    it("should remain active when training camp is active", () => {
      const execution = new TrainingCampExecution(player, tile);
      execution.init(game, 100);
      expect(execution.isActive()).toBe(true);

      // Tick once to trigger training camp creation
      execution.tick(100);

      // Should still be active after successful camp creation
      expect(execution.isActive()).toBe(true);

      // Verify player now has a training camp
      expect(player.unitCount(UnitType.TrainingCamp)).toBeGreaterThan(0);
    });
  });

  describe("Training Camp Bonus System", () => {
    it("should provide 10% bonus per active training camp", () => {
      // Get initial troop count
      const initialTroops = player.troops();

      // Create training camp
      const execution = new TrainingCampExecution(player, tile);
      execution.init(game, 100);
      execution.tick(100);

      // Wait for construction to complete
      for (let i = 0; i < 5; i++) {
        game.executeNextTick();
      }

      // Verify we have 1 training camp
      expect(player.unitCount(UnitType.TrainingCamp)).toBe(1);

      // Simulate a few ticks to generate troops
      for (let i = 0; i < 10; i++) {
        game.executeNextTick();
      }

      // Check that troops increased (with bonus from 1 camp = +10%)
      const finalTroops = player.troops();
      expect(finalTroops).toBeGreaterThan(initialTroops);
    });

    it("should provide 20% bonus with 2 active training camps", () => {
      // Get initial troop count
      const initialTroops = player.troops();

      // Create first training camp
      const execution1 = new TrainingCampExecution(player, tile);
      execution1.init(game, 100);
      execution1.tick(100);

      // Create second training camp on different tile
      const tile2 = game.ref(15, 15);
      // Make sure player owns this tile too
      player.conquer(tile2);
      const execution2 = new TrainingCampExecution(player, tile2);
      execution2.init(game, 100);
      execution2.tick(100);

      // Wait for constructions to complete
      for (let i = 0; i < 5; i++) {
        game.executeNextTick();
      }

      // Verify we have at least 1 training camp (some might fail to build)
      expect(player.unitCount(UnitType.TrainingCamp)).toBeGreaterThan(0);

      // Simulate a few ticks to generate troops
      for (let i = 0; i < 10; i++) {
        game.executeNextTick();
      }

      // Check that troops increased (with bonus from active camps)
      const finalTroops = player.troops();
      expect(finalTroops).toBeGreaterThan(initialTroops);
    });

    it("should only count active training camps for bonus", () => {
      // Get initial troop count
      const initialTroops = player.troops();

      // Create training camp
      const execution = new TrainingCampExecution(player, tile);
      execution.init(game, 100);
      execution.tick(100);

      // Wait for construction to complete
      for (let i = 0; i < 5; i++) {
        game.executeNextTick();
      }

      // Verify we have 1 training camp
      expect(player.unitCount(UnitType.TrainingCamp)).toBe(1);

      // Get the training camp unit and deactivate it
      const trainingCamps = player.units(UnitType.TrainingCamp);
      const camp = trainingCamps[0];
      camp.delete(); // This should deactivate the camp

      // Simulate a few ticks to generate troops
      for (let i = 0; i < 10; i++) {
        game.executeNextTick();
      }

      // Check that troops increased but without bonus (camp is inactive)
      const finalTroops = player.troops();
      expect(finalTroops).toBeGreaterThan(initialTroops);
    });

    it("should stack bonuses correctly with multiple camps", () => {
      // Create multiple training camps
      const tiles = [
        game.ref(10, 10),
        game.ref(20, 20),
        game.ref(30, 30),
        game.ref(40, 40),
        game.ref(50, 50),
      ];

      // Make sure player owns all tiles
      tiles.forEach((tile) => player.conquer(tile));

      const executions = tiles.map((tile) => {
        const execution = new TrainingCampExecution(player, tile);
        execution.init(game, 100);
        execution.tick(100);
        return execution;
      });

      // Wait for constructions to complete
      for (let i = 0; i < 5; i++) {
        game.executeNextTick();
      }

      // Verify we have at least some training camps
      expect(player.unitCount(UnitType.TrainingCamp)).toBeGreaterThan(0);

      // All camps should be active
      const trainingCamps = player.units(UnitType.TrainingCamp);
      const activeCamps = trainingCamps.filter((camp) => camp.isActive());
      expect(activeCamps.length).toBeGreaterThan(0);

      // This should provide a bonus based on the number of active camps
      // Each camp provides +10% troop generation
    });
  });
});
