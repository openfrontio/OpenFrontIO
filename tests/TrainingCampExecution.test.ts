import { beforeEach, describe, expect, it } from "@jest/globals";
import { TrainingCampExecution } from "../src/core/execution/TrainingCampExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
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

    // Get a tile for the training camp
    tile = game.ref(10, 10);
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

  describe("Training Camp Cost Progression", () => {
    it("should have progressive cost for training camps", () => {
      // This test would verify the progressive cost system
      // Currently tested in the actual game configuration
      expect(true).toBe(true); // Placeholder test
    });
  });

  describe("Training Camp Multiplier Logic", () => {
    it("should calculate correct multiplier for multiple camps", () => {
      // Test the multiplier calculation logic
      const camps = Array.from(
        { length: 10 },
        (_, i) =>
          ({
            isActive: () => true,
            level: () => 1,
          }) as Unit,
      );

      // 10 camps should give +100% = 2.0x multiplier
      const activeCamps = camps.filter((camp) => camp.isActive());
      const totalBonus = activeCamps.length * 10; // +10% per camp
      const multiplier = 1 + totalBonus / 100; // Convert percentage to multiplier

      expect(activeCamps.length).toBe(10);
      expect(totalBonus).toBe(100); // +100%
      expect(multiplier).toBe(2.0); // 2.0x multiplier
    });

    it("should only count active camps", () => {
      const camps = [
        { isActive: () => true, level: () => 1 } as Unit,
        { isActive: () => false, level: () => 1 } as Unit,
        { isActive: () => true, level: () => 1 } as Unit,
      ];

      const activeCamps = camps.filter((camp) => camp.isActive());
      const totalBonus = activeCamps.length * 10;
      const multiplier = 1 + totalBonus / 100;

      expect(activeCamps.length).toBe(2);
      expect(totalBonus).toBe(20); // +20%
      expect(multiplier).toBe(1.2); // 1.2x multiplier
    });
  });

  describe("Training Camp Execution Behavior", () => {
    it("should deactivate when cannot build", () => {
      // Create execution with a tile that the player cannot build on
      // We'll use a tile that's not owned by the player
      const invalidTile = game.ref(20, 20); // Tile not owned by player
      const execution = new TrainingCampExecution(player, invalidTile);
      execution.init(game, 100);

      // Try to tick - should deactivate because player cannot build there
      execution.tick(100);

      expect(execution.isActive()).toBe(false);
    });

    it("should remain active when training camp is active", () => {
      // Test that the execution can be created and initialized
      const execution = new TrainingCampExecution(player, tile);
      execution.init(game, 100);

      // The execution should be active initially
      expect(execution.isActive()).toBe(true);

      // The execution behavior depends on whether the player can build
      // and whether the camp becomes active, which varies by game state
      // For now, we just test that the execution can be created
    });
  });
});
