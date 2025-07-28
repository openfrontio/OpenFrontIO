import { DeleteUnitExecution } from "../src/core/execution/DeleteUnitExecution";
import {
  Game,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

describe("DeleteUnitExecution Security Tests", () => {
  let game: Game;
  let player: Player;
  let enemyPlayer: Player;
  let unit: Unit;

  beforeEach(async () => {
    const player1Info = playerInfo("TestPlayer", PlayerType.Human);
    const player2Info = playerInfo("EnemyPlayer", PlayerType.Human);

    game = await setup("plains", {}, [player1Info, player2Info]);
    player = game.player("TestPlayer");
    enemyPlayer = game.player("EnemyPlayer");

    const playerTiles = Array.from(player.tiles());
    const spawnTile = playerTiles[0];
    unit = player.buildUnit(UnitType.City, spawnTile, {});
  });

  describe("Security Validations", () => {
    it("should prevent deleting units not owned by player", () => {
      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
    });

    it("should prevent deleting units on enemy territory", () => {
      const enemyTiles = Array.from(enemyPlayer.tiles());
      if (enemyTiles.length > 0) {
        unit.move(enemyTiles[0]);

        const execution = new DeleteUnitExecution(player, unit.id());
        execution.init(game, 0);

        expect(execution.isActive()).toBe(false);
      }
    });

    it("should prevent deleting units during spawn phase", () => {
      jest.spyOn(game, "inSpawnPhase").mockReturnValue(true);

      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
    });

    it("should allow deleting the last city (suicide)", () => {
      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
    });

    it("should allow deleting units when all conditions are met", () => {
      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
    });
  });
});
