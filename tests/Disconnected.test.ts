import { AttackExecution } from "../src/core/execution/AttackExecution";
import { MarkDisconnectedExecution } from "../src/core/execution/MarkDisconnectedExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { toInt } from "../src/core/Util";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

let game: Game;
const gameID: GameID = "game_id";
let player1: Player;
let player2: Player;
let enemy: Player;

describe("Disconnected", () => {
  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    const player1Info = new PlayerInfo(
      "Active Player",
      PlayerType.Human,
      null,
      "player1_id",
    );

    const player2Info = new PlayerInfo(
      "Disconnected Player",
      PlayerType.Human,
      null,
      "player2_id",
    );

    player1 = game.addPlayer(player1Info);
    player2 = game.addPlayer(player2Info);

    game.addExecution(
      new SpawnExecution(gameID, player1Info, game.ref(1, 1)),
      new SpawnExecution(gameID, player2Info, game.ref(7, 7)),
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

  describe("Disconnected team member interactions", () => {
    const coastX = 7;

    beforeEach(async () => {
      const player1Info = new PlayerInfo(
        "[CLAN]Player1",
        PlayerType.Human,
        null,
        "player_1_id",
      );
      const player2Info = new PlayerInfo(
        "[CLAN]Player2",
        PlayerType.Human,
        null,
        "player_2_id",
      );

      game = await setup(
        "half_land_half_ocean",
        {
          infiniteGold: true,
          instantBuild: true,
          gameMode: GameMode.Team,
          playerTeams: 2, // ignore player2 "kicked" console warn
        },
        [player1Info, player2Info],
        undefined,
        UseRealAttackLogic, // don't use TestConfig's mock attackLogic
      );

      game.addExecution(
        new SpawnExecution(gameID, player1Info, game.map().ref(coastX - 2, 1)),
        new SpawnExecution(gameID, player2Info, game.map().ref(coastX - 2, 4)),
      );

      while (game.inSpawnPhase()) {
        game.executeNextTick();
      }

      player1 = game.player(player1Info.id);
      player2 = game.player(player2Info.id);
      player2.markDisconnected(false);

      expect(player1.team()).not.toBeNull();
      expect(player2.team()).not.toBeNull();
      expect(player1.isOnSameTeam(player2)).toBe(true);
    });

    test("Team Warships should not attack disconnected team mate ships", () => {
      const warship = player1.buildUnit(
        UnitType.Warship,
        game.map().ref(coastX + 1, 10),
        {
          patrolTile: game.map().ref(coastX + 1, 10),
        },
      );
      game.addExecution(new WarshipExecution(warship));

      const transportShip = player2.buildUnit(
        UnitType.TransportShip,
        game.map().ref(coastX + 1, 11),
        {
          troops: 100,
        },
      );

      player2.markDisconnected(true);
      executeTicks(game, 10);

      expect(warship.targetUnit()).toBe(undefined);
      expect(transportShip.isActive()).toBe(true);
      expect(transportShip.owner()).toBe(player2);
    });

    test("Disconnected player Warship should not attack team members' ships", () => {
      const warship = player2.buildUnit(
        UnitType.Warship,
        game.map().ref(coastX + 1, 5),
        {
          patrolTile: game.map().ref(coastX + 1, 10),
        },
      );
      game.addExecution(new WarshipExecution(warship));

      const transportShip = player1.buildUnit(
        UnitType.TransportShip,
        game.map().ref(coastX + 1, 6),
        {
          troops: 100,
        },
      );

      player2.markDisconnected(true);
      executeTicks(game, 10);

      expect(warship.targetUnit()).toBe(undefined);
      expect(transportShip.isActive()).toBe(true);
      expect(transportShip.owner()).toBe(player1);
    });

    test("Player can attack disconnected team mate without troop loss", () => {
      player2.conquer(game.map().ref(coastX - 2, 2));
      player2.conquer(game.map().ref(coastX - 2, 3));
      player2.markDisconnected(true);

      const troopsBeforeAttack = player1.troops();
      const startTroops = troopsBeforeAttack * 0.25;

      game.addExecution(
        new AttackExecution(startTroops, player1, player2.id(), null),
      );

      let expectedTotalGrowth = 0n;
      let afterTickZero = false;

      while (player2.isAlive()) {
        if (afterTickZero) {
          // No growth on tick 0, troop additions start from tick 1
          const troopIncThisTick = game.config().troopIncreaseRate(player1);
          expectedTotalGrowth += toInt(troopIncThisTick);
        }

        game.executeNextTick();
        afterTickZero = true;
      }

      // Tick for retreat() in AttackExecution to add back startTtoops to owner troops
      const troopIncThisTick1 = game.config().troopIncreaseRate(player1);
      expectedTotalGrowth += toInt(troopIncThisTick1);

      game.executeNextTick();

      const expectedFinalTroops = Number(
        toInt(troopsBeforeAttack) + expectedTotalGrowth,
      );

      // Verify no troop loss
      expect(player1.troops()).toBe(expectedFinalTroops);
    });

    test("Conqueror gets conquered disconnected team member's transport- and warships", () => {
      const warship = player2.buildUnit(
        UnitType.Warship,
        game.map().ref(coastX + 1, 1),
        {
          patrolTile: game.map().ref(coastX + 1, 1),
        },
      );
      const transportShip = player2.buildUnit(
        UnitType.TransportShip,
        game.map().ref(coastX + 1, 3),
        {
          troops: 100,
        },
      );

      player2.conquer(game.map().ref(coastX - 2, 1));
      player2.markDisconnected(true);

      game.addExecution(new AttackExecution(1000, player1, player2.id(), null));

      executeTicks(game, 10);

      expect(player2.isAlive()).toBe(false);
      expect(warship.owner()).toBe(player1);
      expect(transportShip.owner()).toBe(player1);
    });

    test("Captured transport ship landing attack should be in name of new owner", () => {
      player2.conquer(game.map().ref(coastX, 1));
      player2.conquer(game.map().ref(coastX - 1, 1));
      player2.conquer(game.map().ref(coastX, 2));

      const enemyShoreTile = game.map().ref(coastX, 15);

      game.addExecution(
        new TransportShipExecution(
          player2,
          null,
          enemyShoreTile,
          100,
          game.map().ref(coastX, 1),
        ),
      );

      executeTicks(game, 1);

      expect(player2.isAlive()).toBe(true);
      const transportShip = player2.units(UnitType.TransportShip)[0];
      expect(player2.units(UnitType.TransportShip).length).toBe(1);

      player2.markDisconnected(true);
      game.addExecution(new AttackExecution(1000, player1, player2.id(), null));

      executeTicks(game, 10);

      expect(player2.isAlive()).toBe(false);
      expect(transportShip.owner()).toBe(player1);

      executeTicks(game, 30);

      // Verify ship landed and tile ownership transferred to new ship owner
      expect(game.owner(enemyShoreTile)).toBe(player1);
    });

    test("Captured transport ship should retreat to owner's shore tile", () => {
      player1.conquer(game.map().ref(coastX, 4));
      player2.conquer(game.map().ref(coastX, 1));

      // Use a far destination so boat is still in transit after attack completes
      const enemyShoreTile = game.map().ref(coastX, 15);

      game.addExecution(
        new TransportShipExecution(
          player2,
          null,
          enemyShoreTile,
          100,
          game.map().ref(coastX, 1),
        ),
      );
      executeTicks(game, 1);

      const transportShip = player2.units(UnitType.TransportShip)[0];
      expect(player2.units(UnitType.TransportShip).length).toBe(1);

      expect(transportShip.targetTile()).toBe(enemyShoreTile);

      player2.markDisconnected(true);
      game.addExecution(new AttackExecution(1000, player1, player2.id(), null));
      executeTicks(game, 10);

      expect(player2.isAlive()).toBe(false);
      expect(transportShip.owner()).toBe(player1);

      transportShip.orderBoatRetreat();
      executeTicks(game, 2);

      expect(transportShip.targetTile()).not.toBe(enemyShoreTile);
      expect(game.owner(transportShip.targetTile()!)).toBe(player1);
    });

    test("Retreating transport ship is deleted if new owner has no shore tiles", () => {
      player2.conquer(game.map().ref(coastX, 1));
      player2.conquer(game.map().ref(coastX - 6, 2));
      player1.conquer(game.map().ref(coastX - 6, 3));

      const enemyShoreTile = game.map().ref(coastX, 15);

      const boatTroops = 100;
      game.addExecution(
        new TransportShipExecution(
          player2,
          null,
          enemyShoreTile,
          boatTroops,
          game.map().ref(coastX, 1),
        ),
      );
      executeTicks(game, 1);

      const transportShip = player2.units(UnitType.TransportShip)[0];
      expect(player2.units(UnitType.TransportShip).length).toBe(1);

      player2.markDisconnected(true);
      game.addExecution(new AttackExecution(1000, player1, player2.id(), null));
      executeTicks(game, 10);

      expect(player2.isAlive()).toBe(false);
      expect(transportShip.owner()).toBe(player1);

      // Make sure player1 has no shore tiles for the ship to retreat to anymore
      const enemyInfo = new PlayerInfo(
        "Enemy",
        PlayerType.Human,
        null,
        "enemy_id",
      );
      enemy = game.addPlayer(enemyInfo);

      const shoreTiles = Array.from(player1.borderTiles()).filter((t) =>
        game.isShore(t),
      );
      shoreTiles.forEach((tile) => {
        enemy.conquer(tile);
      });

      expect(
        Array.from(player1.borderTiles()).filter((t) => game.isShore(t)).length,
      ).toBe(0);

      executeTicks(game, 1);

      const troopIncPerTick = game.config().troopIncreaseRate(player1);
      const expectedTroopGrowth = toInt(troopIncPerTick * 1);
      const expectedFinalTroops = Number(
        toInt(player1.troops()) + expectedTroopGrowth,
      );

      transportShip.orderBoatRetreat();
      executeTicks(game, 1);

      expect(transportShip.isActive()).toBe(false);
      // Also test if boat troops were returned to player1 as new ship owner
      expect(player1.troops()).toBe(expectedFinalTroops + boatTroops);
    });
  });
});
