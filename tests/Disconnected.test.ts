import { MarkDisconnectedExecution } from "../src/core/execution/MarkDisconnectedExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;

describe("Disconnected", () => {
  beforeEach(async () => {
    game = await setup("Plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    const player1Info = new PlayerInfo(
      "us",
      "Active Player",
      PlayerType.Human,
      null,
      "player1_id",
    );

    const player2Info = new PlayerInfo(
      "fr",
      "Disconnected Player",
      PlayerType.Human,
      null,
      "player2_id",
    );

    player1 = game.addPlayer(player1Info);
    player2 = game.addPlayer(player2Info);

    game.addExecution(
      new SpawnExecution(player1Info, game.ref(1, 1)),
      new SpawnExecution(player2Info, game.ref(7, 7)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  describe("Player disconnected state", () => {
    test("should initialize players as not disconnected", () => {
      expect(player1.isDisconnected()).toBe(false);
      expect(player2.isDisconnected()).toBe(false);
    });

    test("should mark player as disconnected", () => {
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);
    });

    test("should mark player as not disconnected", () => {
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);

      player1.markDisconnected(false);
      expect(player1.isDisconnected()).toBe(false);
    });

    test("should include disconnected state in player update", () => {
      player1.markDisconnected(true);
      const update = player1.toUpdate();
      expect(update.isDisconnected).toBe(true);

      player1.markDisconnected(false);
      const update2 = player1.toUpdate();
      expect(update2.isDisconnected).toBe(false);
    });

    test("should maintain disconnected state independently for different players", () => {
      player1.markDisconnected(true);
      player2.markDisconnected(false);

      expect(player1.isDisconnected()).toBe(true);
      expect(player2.isDisconnected()).toBe(false);
    });
  });

  describe("MarkDisconnectedExecution", () => {
    test("should mark player as disconnected when executed", () => {
      const execution = new MarkDisconnectedExecution(player1.id(), true);
      game.addExecution(execution);

      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(true);
      expect(execution.isActive()).toBe(false);
    });

    test("should mark player as not disconnected when executed", () => {
      // First mark as disconnected directly
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);

      // Then mark as not disconnected via execution
      const execution = new MarkDisconnectedExecution(player1.id(), false);
      game.addExecution(execution);

      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(false);
      expect(execution.isActive()).toBe(false);
    });

    test("should handle multiple players with different disconnected states", () => {
      const execution1 = new MarkDisconnectedExecution(player1.id(), true);
      const execution2 = new MarkDisconnectedExecution(player2.id(), false);

      game.addExecution(execution1, execution2);
      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(true);
      expect(player2.isDisconnected()).toBe(false);
      expect(execution1.isActive()).toBe(false);
      expect(execution2.isActive()).toBe(false);
    });

    test("should handle invalid player ID gracefully", () => {
      const execution = new MarkDisconnectedExecution(
        "invalid_player_id",
        true,
      );
      game.addExecution(execution);

      // Should not throw and should deactivate
      expect(() => game.executeNextTick()).not.toThrow();
      expect(execution.isActive()).toBe(false);
    });

    test("should not be active during spawn phase", () => {
      const execution = new MarkDisconnectedExecution(player1.id(), true);
      expect(execution.activeDuringSpawnPhase()).toBe(false);
    });

    test("should handle rapid disconnected state changes", () => {
      // Mark disconnected
      const execution1 = new MarkDisconnectedExecution(player1.id(), true);
      game.addExecution(execution1);
      executeTicks(game, 2);
      expect(player1.isDisconnected()).toBe(true);

      // Mark not disconnected
      const execution2 = new MarkDisconnectedExecution(player1.id(), false);
      game.addExecution(execution2);
      executeTicks(game, 2);
      expect(player1.isDisconnected()).toBe(false);

      // Mark disconnected again
      const execution3 = new MarkDisconnectedExecution(player1.id(), true);
      game.addExecution(execution3);
      executeTicks(game, 2);
      expect(player1.isDisconnected()).toBe(true);
    });

    test("should execute properly with other executions in same tick", () => {
      const markDisconnectedExecution = new MarkDisconnectedExecution(
        player1.id(),
        true,
      );
      const markDisconnectedExecution2 = new MarkDisconnectedExecution(
        player2.id(),
        false,
      );

      game.addExecution(markDisconnectedExecution, markDisconnectedExecution2);

      // Execute multiple ticks to ensure all executions complete
      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(true);
      expect(player2.isDisconnected()).toBe(false);
      expect(markDisconnectedExecution.isActive()).toBe(false);
      expect(markDisconnectedExecution2.isActive()).toBe(false);
    });
  });

  describe("Disconnected state persistence", () => {
    test("should maintain disconnected state across game ticks", () => {
      player1.markDisconnected(true);

      // Execute several ticks
      executeTicks(game, 5);

      // Disconnected state should persist
      expect(player1.isDisconnected()).toBe(true);
    });

    test("should maintain disconnected state in player updates", () => {
      player1.markDisconnected(true);

      // Execute some ticks and check update still shows disconnected
      executeTicks(game, 3);

      const update = player1.toUpdate();
      expect(update.isDisconnected).toBe(true);
    });

    test("should handle execution during different game phases", () => {
      // Test that disconnected execution works outside spawn phase
      expect(game.inSpawnPhase()).toBe(false);

      const execution = new MarkDisconnectedExecution(player1.id(), true);
      game.addExecution(execution);
      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(true);
      expect(execution.isActive()).toBe(false);
    });
  });

  describe("Edge cases", () => {
    test("should handle marking same disconnected state multiple times", () => {
      // Mark disconnected multiple times
      player1.markDisconnected(true);
      player1.markDisconnected(true);
      player1.markDisconnected(true);

      expect(player1.isDisconnected()).toBe(true);

      // Mark not disconnected multiple times
      player1.markDisconnected(false);
      player1.markDisconnected(false);
      player1.markDisconnected(false);

      expect(player1.isDisconnected()).toBe(false);
    });

    test("should handle execution with same disconnected state", () => {
      // Start with player disconnected
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);

      // Execute with same disconnected state
      const execution = new MarkDisconnectedExecution(player1.id(), true);
      game.addExecution(execution);
      executeTicks(game, 2);

      expect(player1.isDisconnected()).toBe(true);
      expect(execution.isActive()).toBe(false);
    });

    test("should handle missing player during execution init", () => {
      const execution = new MarkDisconnectedExecution(
        "nonexistent_player",
        true,
      );

      // Mock console.warn to verify it's called
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      game.addExecution(execution);
      executeTicks(game, 2);

      expect(execution.isActive()).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "MarkDisconnectedExecution: player nonexistent_player not found",
        ),
      );

      consoleSpy.mockRestore();
    });

    test("should handle multiple executions for same player", () => {
      const execution1 = new MarkDisconnectedExecution(player1.id(), true);
      const execution2 = new MarkDisconnectedExecution(player1.id(), false);

      game.addExecution(execution1, execution2);
      executeTicks(game, 2);

      // Last execution should win
      expect(player1.isDisconnected()).toBe(false);
      expect(execution1.isActive()).toBe(false);
      expect(execution2.isActive()).toBe(false);
    });
  });
});
