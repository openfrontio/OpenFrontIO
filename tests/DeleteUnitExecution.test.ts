import { DeleteUnitExecution } from "../src/core/execution/DeleteUnitExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("DeleteUnitExecution Security Tests", () => {
  let game: Game;
  let player: Player;
  let enemyPlayer: Player;
  let unit: Unit;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const player1Info = new PlayerInfo(
      "TestPlayer",
      PlayerType.Human,
      null,
      "TestPlayer",
    );
    const player2Info = new PlayerInfo(
      "EnemyPlayer",
      PlayerType.Human,
      null,
      "EnemyPlayer",
    );

    game.addPlayer(player1Info);
    game.addPlayer(player2Info);

    const playerSpawn: TileRef = game.ref(0, 10);
    const enemySpawn: TileRef = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(game.player(player1Info.id).info(), playerSpawn),
      new SpawnExecution(game.player(player2Info.id).info(), enemySpawn),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player(player1Info.id);
    enemyPlayer = game.player(player2Info.id);

    const playerTiles = Array.from(player.tiles());
    if (playerTiles.length === 0) {
      throw new Error("Player has no tiles");
    }
    const spawnTile = playerTiles[0];
    unit = player.buildUnit(UnitType.City, spawnTile, {});

    const tileOwner = game.owner(unit.tile());
    if (!tileOwner.isPlayer() || tileOwner.id() !== player.id()) {
      throw new Error("Unit is not on player's territory");
    }
  });

  describe("Security Validations", () => {
    it("should prevent deleting units not owned by player", () => {
      const enemyUnit = enemyPlayer.buildUnit(
        UnitType.City,
        Array.from(enemyPlayer.tiles())[0],
        {},
      );
      const execution = new DeleteUnitExecution(player, enemyUnit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
      expect(enemyUnit.isMarkedForDeletion()).toBe(false);
    });

    it("should prevent deleting units on enemy territory", () => {
      const enemyTiles = Array.from(enemyPlayer.tiles());
      if (enemyTiles.length > 0) {
        unit.move(enemyTiles[0]);

        const execution = new DeleteUnitExecution(player, unit.id());
        execution.init(game, 0);

        expect(execution.isActive()).toBe(false);
        expect(unit.isMarkedForDeletion()).toBe(false);
      }
    });

    it("should prevent deleting units during spawn phase", () => {
      jest.spyOn(game, "inSpawnPhase").mockReturnValue(true);

      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(execution.isActive()).toBe(false);
      expect(unit.isMarkedForDeletion()).toBe(false);
    });

    it("should allow deleting units when all conditions are met", () => {
      jest.spyOn(game, "inSpawnPhase").mockReturnValue(false);

      const execution = new DeleteUnitExecution(player, unit.id());
      execution.init(game, 0);

      expect(unit.isMarkedForDeletion()).toBe(true);
    });

    it("should delete after deletion delay", () => {
      jest.spyOn(game, "inSpawnPhase").mockReturnValue(false);

      const execution = new DeleteUnitExecution(player, unit.id());
      game.addExecution(execution);

      game.executeNextTick();
      expect(unit.isMarkedForDeletion()).toBe(true);
      expect(unit.isOverdueDeletion()).toBe(false);
      executeTicks(game, game.config().deletionMarkDuration() + 1);
      expect(unit.isActive()).toBe(false);
    });

    it("should reset deletion if captured", () => {
      jest.spyOn(game, "inSpawnPhase").mockReturnValue(false);

      const execution = new DeleteUnitExecution(player, unit.id());
      game.addExecution(execution);
      game.executeNextTick();
      expect(unit.isMarkedForDeletion()).toBe(true);
      unit.setOwner(enemyPlayer);
      expect(unit.isMarkedForDeletion()).toBe(false);
      expect(unit.isActive()).toBe(true);
    });
  });
});
