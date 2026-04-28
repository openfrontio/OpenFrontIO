import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { PathStatus } from "../src/core/pathfinding/types";
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
      new MoveWarshipExecution(
        player1,
        [warship.id()],
        game.ref(coastX + 5, 15),
      ),
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
    game.config().warshipShellAttackRate = () => Number.MAX_SAFE_INTEGER;

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

    let selectedType: UnitType | undefined = undefined;
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
      selectedType = warship.targetUnit()?.type();
      if (selectedType === UnitType.TransportShip) {
        break;
      }
    }

    expect(selectedType).toBe(UnitType.TransportShip);
  });

  test("Warship does not target trade ships in different water components", async () => {
    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warshipTile = game.ref(coastX + 1, 2);
    const tradeShipTile = game.ref(coastX + 1, 12);

    const warship = player1.buildUnit(UnitType.Warship, warshipTile, {
      patrolTile: warshipTile,
    });
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(UnitType.TradeShip, tradeShipTile, {
      targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
    });

    // Mock different water components
    game.getWaterComponent = (tile: TileRef) => {
      if (tile === warshipTile) return 1;
      return 2;
    };

    game.hasWaterComponent = (tile: TileRef, component: number) => {
      return game.getWaterComponent(tile) === component;
    };

    executeTicks(game, 10);

    // Trade ship should not be captured because it's in a different component
    expect(tradeShip.owner().id()).toBe(player2.id());
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
      [warship.id()],
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
      [warship.id()],
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails gracefully if warship not found", async () => {
    const exec = new MoveWarshipExecution(
      player1,
      [123],
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

    game.config().warshipPortHealingBonusPerLevel = () => 0;
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

  test("Warship gets active healing when docked at a friendly port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    game.config().warshipPassiveHealing = () => 0;
    game.config().warshipPortHealingBonusPerLevel = () => 6;
    game.config().warshipDockingRange = () => 5;
    game.config().warshipRetreatHealthThreshold = () => 900;

    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    const warshipExecution = new WarshipExecution(warship);
    game.addExecution(warshipExecution);

    game.executeNextTick();
    warship.modifyHealth(-300);

    for (let i = 0; i < 60; i++) {
      game.executeNextTick();
      if (warshipExecution.isDocked()) {
        break;
      }
    }

    expect(warshipExecution.isDocked()).toBe(true);
    const before = warship.health();
    game.executeNextTick();
    expect(warship.health()).toBe(before + 6);
  });

  test("Warship waits at port when capacity is full", async () => {
    game.config().warshipPassiveHealing = () => 0;
    game.config().warshipDockingRange = () => 5;
    game.config().warshipRetreatHealthThreshold = () => 900;

    const portTile = game.ref(coastX, 10);
    const warship1Tile = game.ref(coastX + 1, 11);
    const warship2Tile = game.ref(coastX + 1, 12);

    player1.buildUnit(UnitType.Port, portTile, {});
    const warship1 = player1.buildUnit(UnitType.Warship, warship1Tile, {
      patrolTile: warship1Tile,
    });
    const warship2 = player1.buildUnit(UnitType.Warship, warship2Tile, {
      patrolTile: warship2Tile,
    });

    const exec1 = new WarshipExecution(warship1);
    const exec2 = new WarshipExecution(warship2);
    game.addExecution(exec1);
    game.addExecution(exec2);

    game.executeNextTick();
    warship1.modifyHealth(-300);
    warship2.modifyHealth(-300);

    for (let i = 0; i < 80; i++) {
      game.executeNextTick();
      const warship2DistanceToPort = game.euclideanDistSquared(
        warship2.tile(),
        portTile,
      );
      if (
        exec1.isDocked() &&
        !exec2.isDocked() &&
        warship2DistanceToPort <= 25 &&
        warship2.retreating()
      ) {
        break;
      }
    }

    const warship2DistanceToPort = game.euclideanDistSquared(
      warship2.tile(),
      portTile,
    );
    expect(exec1.isDocked()).toBe(true);
    expect(exec2.isDocked()).toBe(false);
    expect(warship2DistanceToPort).toBeLessThanOrEqual(25);
    expect(warship2.retreating()).toBe(true);
  });

  test("Warship cancels docking if its retreat port is destroyed", async () => {
    game.config().warshipPassiveHealing = () => 0;
    game.config().warshipPortHealingBonusPerLevel = () => 0;
    game.config().warshipDockingRange = () => 5;
    game.config().warshipRetreatHealthThreshold = () => 900;

    const homePort = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    const warshipExecution = new WarshipExecution(warship);
    game.addExecution(warshipExecution);

    game.executeNextTick();
    warship.modifyHealth(-300);

    for (let i = 0; i < 60; i++) {
      game.executeNextTick();
      if (warshipExecution.isDocked()) {
        break;
      }
    }

    expect(warshipExecution.isDocked()).toBe(true);

    homePort.delete();
    game.executeNextTick();

    expect(warshipExecution.isDocked()).toBe(false);
    expect(warship.retreating()).toBe(false);
  });

  test("Warship drops a stale target after patrol movement changes range", async () => {
    game.config().warshipTargettingRange = () => 1;
    game.config().warshipShellAttackRate = () => Number.MAX_SAFE_INTEGER;
    const startTile = game.ref(coastX + 1, 10);
    const movedTile = game
      .map()
      .neighbors(startTile)
      .find((tile) => game.isOcean(tile));

    expect(movedTile).toBeDefined();

    const warship = player1.buildUnit(UnitType.Warship, startTile, {
      patrolTile: startTile,
    });
    warship.setTargetTile(movedTile!);
    const transport = player2.buildUnit(UnitType.TransportShip, movedTile!, {
      targetTile: movedTile!,
    });

    const execution = new WarshipExecution(warship);
    const executionInternals = execution as unknown as {
      findTargetUnit: () => typeof transport | undefined;
      pathfinder: {
        next: () => { status: PathStatus; node: number };
      };
    };
    execution.init(game, game.ticks());

    vi.spyOn(executionInternals, "findTargetUnit")
      .mockReturnValueOnce(transport)
      .mockReturnValueOnce(undefined);
    vi.spyOn(executionInternals.pathfinder, "next").mockReturnValue({
      status: PathStatus.NEXT,
      node: movedTile!,
    });

    execution.tick(game.ticks());

    expect(warship.tile()).toBe(movedTile);
    expect(warship.targetUnit()).toBeUndefined();
  });

  test("Warship cancels retreat if no friendly port is reachable by water", async () => {
    game.config().warshipRetreatHealthThreshold = () => 900;

    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 11),
      {
        patrolTile: game.ref(coastX + 1, 11),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const warshipTile = warship.tile();
    vi.spyOn(game, "getWaterComponent").mockImplementation((tile) =>
      tile === warshipTile ? 1 : 2,
    );
    vi.spyOn(game, "hasWaterComponent").mockReturnValue(false);

    game.executeNextTick();
    warship.modifyHealth(-300);
    game.executeNextTick();

    expect(warship.retreating()).toBe(false);
  });
});
