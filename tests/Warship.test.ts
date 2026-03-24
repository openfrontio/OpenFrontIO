import { HealAtPortExecution } from "../src/core/execution/HealAtPortExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Warship", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Warship heals only if player has port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();

    expect(warship.health()).toBe(maxHealth);
    warship.modifyHealth(-10);
    expect(warship.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);
  });

  test("Warship captures trade if player has port", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.owner()).toBe(player1);
  });

  test("Warship do not capture trade if player has no port", async () => {
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(UnitType.Port, game.ref(coastX, 11), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for warship to potentially capture trade ship
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship does not target trade ships that are safe from pirates", async () => {
    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    tradeShip.setSafeFromPirates();

    executeTicks(game, 10);

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship moves to new patrol tile", async () => {
    game.config().warshipTargettingRange = () => 1;

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship));

    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), game.ref(coastX + 5, 15)),
    );

    executeTicks(game, 10);

    expect(warship.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Warship does not not target trade ships outside of patrol range", async () => {
    game.config().warshipTargettingRange = () => 3;

    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship prioritizes transport ships over warships", async () => {
    game.config().warshipShellAttackRate = () => 10_000;

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    player2.buildUnit(UnitType.Warship, game.ref(coastX + 2, 10), {
      patrolTile: game.ref(coastX + 2, 10),
    });
    player2.buildUnit(UnitType.TransportShip, game.ref(coastX + 1, 11), {
      targetTile: game.ref(coastX + 1, 11),
    });

    game.addExecution(new WarshipExecution(warship));
    game.executeNextTick();

    expect(warship.targetUnit()?.type()).toBe(UnitType.TransportShip);
  });

  test("MoveWarshipExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveWarshipExecution(
      player2,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails if warship is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    warship.delete();
    new MoveWarshipExecution(
      player1,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails gracefully if warship not found", async () => {
    const exec = new MoveWarshipExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });

  test("Warship retreats when pre-heal health is below threshold", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }
    if (maxHealth <= 599) {
      expect(maxHealth).toBeGreaterThan(599);
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-(maxHealth - 599));

    game.executeNextTick();

    expect(warship.retreating()).toBe(true);
    const distanceToPort = game.euclideanDistSquared(
      warship.tile(),
      homePort.tile(),
    );
    expect(
      distanceToPort <= 25 || warship.targetTile() === homePort.tile(),
    ).toBe(true);
  });

  test("Warship gets bonus healing when near friendly port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPortHealingBonus = () => 3;
    game.config().warshipPortHealingRadius = () => 30;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-10);
    game.executeNextTick();

    expect(warship.health()).toBe(maxHealth - 9);
  });

  test("Warship waits at port when capacity is full", async () => {
    game.config().warshipPortHealingRadius = () => 30;
    game.config().warshipRetreatHealthThreshold = () => 600;

    const portTile = game.ref(coastX, 10);
    const warship1Tile = game.ref(coastX, 11);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship1 = player1.buildUnit(UnitType.Warship, warship1Tile, {
      patrolTile: warship1Tile,
    });

    const exec1 = new WarshipExecution(warship1);
    game.addExecution(exec1);

    game.executeNextTick();
    warship1.modifyHealth(-700);

    let previousTile = warship1.tile();
    for (let i = 0; i < 50; i++) {
      executeTicks(game, 1);
      const currentTile = warship1.tile();
      if (currentTile === previousTile && exec1.isDocked()) {
        break;
      }
      previousTile = currentTile;
    }

    const distanceToPort = game.euclideanDistSquared(warship1.tile(), portTile);
    expect(distanceToPort).toBeLessThanOrEqual(25);
    expect(exec1.isDocked()).toBe(true);
  });

  test("Low-health warship does not retreat when enemy warship is nearby", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;
    game.config().warshipTargettingRange = () => 5;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 5), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 15),
      {
        patrolTile: game.ref(coastX + 1, 15),
      },
    );
    const enemyWarship = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 15),
      {
        patrolTile: game.ref(coastX + 2, 15),
      },
    );

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new WarshipExecution(enemyWarship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    game.executeNextTick();

    expect(warship.targetUnit()).toBe(enemyWarship);
    expect(warship.targetTile()).not.toBe(homePort.tile());
    expect(warship.retreating()).toBe(false);
  });

  test("Retreating warship aggroes nearby enemy transport before continuing retreat", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;
    game.config().warshipTargettingRange = () => 5;
    game.config().warshipShellAttackRate = () => 10_000;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 6, 12),
      {
        patrolTile: game.ref(coastX + 6, 12),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 4);
    expect(warship.retreating()).toBe(true);

    const enemyTransport = player2.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX + 5, 12),
      {
        targetTile: game.ref(coastX + 5, 12),
      },
    );

    game.executeNextTick();

    expect(warship.retreating()).toBe(true);
    expect(warship.targetTile()).toBe(homePort.tile());
    expect(warship.targetUnit()).toBe(enemyTransport);
  });

  test("Manual MoveWarshipExecution cancels retreat and keeps manual order", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();
    warship.modifyHealth(-700);
    executeTicks(game, 20);

    expect(warship.retreating()).toBe(true);

    const manualPatrolTile = game.ref(coastX + 5, 15);
    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), manualPatrolTile),
    );

    executeTicks(game, 2);

    expect(warship.retreating()).toBe(false);
    expect(warship.patrolTile()).toBe(manualPatrolTile);
    expect(warship.targetTile()).toBe(manualPatrolTile);
  });

  test("Manual MoveWarshipExecution suppresses auto-retreat for 5 seconds before retreat starts", async () => {
    game.config().warshipPortHealingBonus = () => 0;
    game.config().warshipRetreatHealthThreshold = () => 600;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));
    game.executeNextTick();

    const manualPatrolTile = game.ref(coastX + 6, 15);
    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), manualPatrolTile),
    );
    game.executeNextTick();

    warship.modifyHealth(-700);

    game.executeNextTick();
    expect(warship.retreating()).toBe(false);
    expect(warship.patrolTile()).toBe(manualPatrolTile);

    executeTicks(game, 48);
    expect(warship.retreating()).toBe(false);

    game.executeNextTick();
    expect(warship.retreating()).toBe(true);
  });

  test("HealAtPortExecution moves warship to port", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    game.executeNextTick();

    expect(warship.patrolTile()).toBe(portTile);
    expect(warship.targetTile()).toBe(portTile);
    expect(warship.retreating()).toBe(true);
  });

  test("HealAtPortExecution ignores enemy port targets", async () => {
    const portTile = game.ref(coastX, 10);
    const warshipTile = game.ref(coastX + 1, 10);

    player2.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });
    const initialPatrolTile = warship.patrolTile();
    const initialTargetTile = warship.targetTile();

    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new HealAtPortExecution(player1, warship.id(), portTile));

    game.executeNextTick();

    expect(warship.patrolTile()).toBe(initialPatrolTile);
    expect(warship.targetTile()).toBe(initialTargetTile);
    expect(warship.retreating()).toBe(false);
  });
});
