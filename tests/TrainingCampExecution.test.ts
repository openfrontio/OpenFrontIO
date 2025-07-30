import { beforeEach, describe, expect, it } from "@jest/globals";
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
});
