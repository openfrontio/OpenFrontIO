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
      undefined,
      "us",
      "Active Player",
      PlayerType.Human,
      null,
      "player1_id",
    );

    const player2Info = new PlayerInfo(
      undefined,
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

    test("should mark player as disconnected and not disconnected", () => {
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);

      player1.markDisconnected(false);
      expect(player1.isDisconnected()).toBe(false);
    });

    test("should include disconnected state in player update", () => {
      player1.markDisconnected(true);
      const update = player1.toUpdate();
      expect(update.isDisconnected).toBe(true);
    });
  });

  describe("Player view", () => {
    test("should reflect disconnected state in player view", () => {
      // Mark player2 as disconnected
      player2.markDisconnected(true);

      // Get player1's view of player2
      const player2View = game.player(player2.id());
      expect(player2View.isDisconnected()).toBe(true);

      // Mark player2 as connected again
      player2.markDisconnected(false);

      // Verify the view is updated
      const updatedPlayer2View = game.player(player2.id());
      expect(updatedPlayer2View.isDisconnected()).toBe(false);
    });

    test("should maintain disconnected state in view across game ticks", () => {
      player2.markDisconnected(true);
      executeTicks(game, 3);

      const player2View = game.player(player2.id());
      expect(player2View.isDisconnected()).toBe(true);
    });
  });

  describe("MarkDisconnectedExecution", () => {
    test("should mark player as disconnected when executed", () => {
      const execution = new MarkDisconnectedExecution(player1, true);
      game.addExecution(execution);
      executeTicks(game, 1);
      expect(player1.isDisconnected()).toBe(true);
      expect(execution.isActive()).toBe(false);
    });

    test("should handle multiple players with different disconnected states", () => {
      const execution1 = new MarkDisconnectedExecution(player1, true);
      const execution2 = new MarkDisconnectedExecution(player2, false);
      game.addExecution(execution1, execution2);
      executeTicks(game, 1);
      expect(player1.isDisconnected()).toBe(true);
      expect(player2.isDisconnected()).toBe(false);
    });

    test("should not be active during spawn phase", () => {
      const execution = new MarkDisconnectedExecution(player1, true);
      expect(execution.activeDuringSpawnPhase()).toBe(false);
    });

    test("should handle multiple executions for same player in same tick", () => {
      const execution1 = new MarkDisconnectedExecution(player1, true);
      const execution2 = new MarkDisconnectedExecution(player1, false);
      game.addExecution(execution1, execution2);
      executeTicks(game, 1);
      // Last execution should win
      expect(player1.isDisconnected()).toBe(false);
    });
  });

  describe("Disconnected state persistence", () => {
    test("should maintain disconnected state across game ticks", () => {
      player1.markDisconnected(true);
      executeTicks(game, 5);
      expect(player1.isDisconnected()).toBe(true);
    });

    test("should maintain disconnected state in player updates across ticks", () => {
      player1.markDisconnected(true);
      executeTicks(game, 3);
      const update = player1.toUpdate();
      expect(update.isDisconnected).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("should handle marking same disconnected state multiple times", () => {
      player1.markDisconnected(true);
      player1.markDisconnected(true);
      player1.markDisconnected(true);
      expect(player1.isDisconnected()).toBe(true);

      player1.markDisconnected(false);
      player1.markDisconnected(false);
      player1.markDisconnected(false);
      expect(player1.isDisconnected()).toBe(false);
    });

    test("should handle execution with same disconnected state", () => {
      player1.markDisconnected(true);
      const execution = new MarkDisconnectedExecution(player1, true);
      game.addExecution(execution);
      executeTicks(game, 1);
      expect(player1.isDisconnected()).toBe(true);
    });
  });
});
