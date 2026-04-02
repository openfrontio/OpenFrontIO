import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
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

function buildWarship(
  owner: Player,
  tile = game.ref(coastX + 3, 10),
  level = 1,
) {
  const warship = owner.buildUnit(UnitType.Warship, tile, {
    patrolTile: tile,
  });
  for (let i = 1; i < level; i++) {
    warship.increaseLevel();
  }
  game.addExecution(new WarshipExecution(warship));
  return warship;
}

function buildShortNuke(
  owner: Player,
  type: UnitType.AtomBomb | UnitType.HydrogenBomb,
  targetTile: number,
) {
  return owner.buildUnit(type, game.ref(coastX + 3, 8), {
    targetTile,
    trajectory: [
      { tile: game.ref(coastX + 3, 8), targetable: true },
      { tile: game.ref(coastX + 4, 9), targetable: true },
      { tile: targetTile, targetable: true },
    ],
  });
}

async function setupGame(gameConfig: Parameters<typeof setup>[1] = {}) {
  game = await setup(
    "half_land_half_ocean",
    {
      infiniteGold: true,
      instantBuild: true,
      ...gameConfig,
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
}

describe("Warship", () => {
  beforeEach(async () => {
    await setupGame();
  });

  test("Warship can be upgraded through buildables and upgrade execution", async () => {
    await setupGame({ infiniteGold: false });
    player1.addGold(1_000_000n);
    player1.conquer(game.ref(coastX, 10));
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 3, 10),
      {
        patrolTile: game.ref(coastX + 3, 10),
      },
    );

    const buildable = player1
      .buildableUnits(game.ref(coastX + 3, 10))
      .find((bu) => bu.type === UnitType.Warship);

    expect(buildable).toBeDefined();
    expect(buildable!.canUpgrade).toBe(warship.id());

    game.addExecution(new UpgradeStructureExecution(player1, warship.id()));
    executeTicks(game, 2);

    expect(warship.level()).toBe(2);
  });

  test("Warship upgrade is blocked when too far, under construction, marked for deletion, or unaffordable", async () => {
    await setupGame({ infiniteGold: false });
    player1.addGold(1_000_000n);
    player1.conquer(game.ref(coastX, 10));
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const nearbyWarship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 3, 10),
      {
        patrolTile: game.ref(coastX + 3, 10),
      },
    );
    expect(
      player1.findUnitToUpgrade(UnitType.Warship, game.ref(coastX + 3, 10)),
    ).toBe(nearbyWarship);
    game.config().structureMinDist = () => 1;
    expect(
      player1.findUnitToUpgrade(UnitType.Warship, game.ref(coastX + 3, 12)),
    ).toBe(false);

    nearbyWarship.setUnderConstruction(true);
    expect(
      player1.findUnitToUpgrade(UnitType.Warship, game.ref(coastX + 3, 10)),
    ).toBe(false);
    nearbyWarship.setUnderConstruction(false);

    nearbyWarship.markForDeletion();
    expect(
      player1.findUnitToUpgrade(UnitType.Warship, game.ref(coastX + 3, 10)),
    ).toBe(false);

    const unaffordableWarship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 6, 10),
      {
        patrolTile: game.ref(coastX + 6, 10),
      },
    );

    player1.removeGold(player1.gold());
    expect(
      player1.findUnitToUpgrade(UnitType.Warship, unaffordableWarship.tile()),
    ).toBe(false);
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

  test("Level 1 warship does not intercept sea-targeted nukes", async () => {
    game.config().warshipPatrolRange = () => 0;
    buildWarship(player1);

    const nuke = buildShortNuke(
      player2,
      UnitType.AtomBomb,
      game.ref(coastX + 5, 10),
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBe(true);
  });

  test.each([UnitType.AtomBomb, UnitType.HydrogenBomb] as const)(
    "Level 2 warship intercepts %s aimed at sea",
    async (nukeType) => {
      game.config().warshipPatrolRange = () => 0;
      buildWarship(player1, game.ref(coastX + 3, 10), 2);

      const nuke = buildShortNuke(player2, nukeType, game.ref(coastX + 5, 10));

      executeTicks(game, 3);

      expect(nuke.isActive()).toBe(false);
    },
  );

  test("Level 2 warship ignores land-targeted nukes", async () => {
    game.config().warshipPatrolRange = () => 0;
    buildWarship(player1, game.ref(coastX + 3, 10), 2);

    const nuke = buildShortNuke(
      player2,
      UnitType.AtomBomb,
      game.ref(coastX, 10),
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBe(true);
  });

  test("Two upgraded warships do not target the same nuke twice", async () => {
    game.config().warshipPatrolRange = () => 0;
    const warship1 = buildWarship(player1, game.ref(coastX + 3, 10), 2);
    const warship2 = buildWarship(player1, game.ref(coastX + 3, 11), 2);

    const nuke = buildShortNuke(
      player2,
      UnitType.AtomBomb,
      game.ref(coastX + 5, 10),
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBe(false);
    expect([warship1, warship2].filter((w) => w.isInCooldown())).toHaveLength(
      1,
    );
  });

  test("Upgraded warship uses SAM cooldown timing after intercepting", async () => {
    game.config().warshipPatrolRange = () => 0;
    const warship = buildWarship(player1, game.ref(coastX + 3, 10), 2);

    const nuke = buildShortNuke(
      player2,
      UnitType.AtomBomb,
      game.ref(coastX + 5, 10),
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBe(false);
    expect(warship.isInCooldown()).toBe(true);

    for (let i = 0; i < game.config().SAMCooldown() - 3; i++) {
      game.executeNextTick();
      expect(warship.isInCooldown()).toBe(true);
    }

    executeTicks(game, 2);

    expect(warship.isInCooldown()).toBe(false);
  });

  test("Level 2 warship intercepts sea-targeted MIRV warheads", async () => {
    game.config().warshipPatrolRange = () => 0;
    const warship = buildWarship(player1, game.ref(coastX + 3, 10), 2);
    const seaTarget = game.ref(coastX + 4, 10);

    const warhead1 = player2.buildUnit(
      UnitType.MIRVWarhead,
      game.ref(coastX + 6, 10),
      {
        targetTile: seaTarget,
      },
    );
    const warhead2 = player2.buildUnit(
      UnitType.MIRVWarhead,
      game.ref(coastX + 6, 11),
      {
        targetTile: seaTarget,
      },
    );

    executeTicks(game, 2);

    expect(warhead1.isActive()).toBe(false);
    expect(warhead2.isActive()).toBe(false);
    expect(warship.isInCooldown()).toBe(true);
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
});
