import { AttackExecution } from "../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  GameUpdates,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameUpdateType, UnitUpdate } from "../src/core/game/GameUpdates";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

const gameID: GameID = "game_id";
let game: Game;
let defender: Player;
let attacker: Player;
let defenderSpawn: TileRef;
let attackerSpawn: TileRef;

describe("LandMine", () => {
  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const defenderInfo = new PlayerInfo(
      "defender",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);

    defenderSpawn = game.ref(10, 10);
    attackerSpawn = game.ref(20, 10);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(defenderInfo.id).info(),
        defenderSpawn,
      ),
      new SpawnExecution(
        gameID,
        game.player(attackerInfo.id).info(),
        attackerSpawn,
      ),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    defender = game.player(defenderInfo.id);
    attacker = game.player(attackerInfo.id);

    game.addExecution(
      new AttackExecution(50, defender, game.terraNullius().id()),
    );
    game.addExecution(
      new AttackExecution(50, attacker, game.terraNullius().id()),
    );

    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
    }
  });

  test("land mine should be buildable", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    expect(defender.units(UnitType.LandMine)).toHaveLength(1);
  });

  test("land mine should explode when enemy captures the tile", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];
    expect(mine).toBeDefined();
    expect(mine.isActive()).toBe(true);

    const mineTile = mine.tile();

    game.addExecution(new AttackExecution(100, attacker, defender.id()));

    let ticks = 0;
    const maxTicks = 500;
    while (game.owner(mineTile) !== attacker && ticks < maxTicks) {
      game.executeNextTick();
      ticks++;
    }

    executeTicks(game, 5);

    expect(mine.isActive()).toBe(false);
  });

  test("land mine explosion should only hurt the attacker, not the original owner", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];
    const mineTile = mine.tile();

    const defenderInitialTiles = defender.numTilesOwned();

    game.addExecution(new AttackExecution(100, attacker, defender.id()));

    let ticks = 0;
    const maxTicks = 500;
    while (game.owner(mineTile) !== attacker && ticks < maxTicks) {
      game.executeNextTick();
      ticks++;
    }

    const defenderTilesAfterCapture = defender.numTilesOwned();

    executeTicks(game, 5);

    expect(defender.numTilesOwned()).toBeGreaterThanOrEqual(
      defenderTilesAfterCapture - 5,
    );
  });

  test("land mine should NOT explode while under construction", async () => {
    const slowBuildGame = await setup("plains", {
      infiniteGold: true,
      instantBuild: false,
      infiniteTroops: true,
    });

    const defenderInfo2 = new PlayerInfo(
      "defender2",
      PlayerType.Human,
      null,
      "defender2_id",
    );
    slowBuildGame.addPlayer(defenderInfo2);

    const attackerInfo2 = new PlayerInfo(
      "attacker2",
      PlayerType.Human,
      null,
      "attacker2_id",
    );
    slowBuildGame.addPlayer(attackerInfo2);

    slowBuildGame.addExecution(
      new SpawnExecution(
        gameID,
        slowBuildGame.player(defenderInfo2.id).info(),
        slowBuildGame.ref(10, 10),
      ),
      new SpawnExecution(
        gameID,
        slowBuildGame.player(attackerInfo2.id).info(),
        slowBuildGame.ref(20, 10),
      ),
    );

    while (slowBuildGame.inSpawnPhase()) {
      slowBuildGame.executeNextTick();
    }

    const defender2 = slowBuildGame.player(defenderInfo2.id);
    const attacker2 = slowBuildGame.player(attackerInfo2.id);

    slowBuildGame.addExecution(
      new AttackExecution(50, defender2, slowBuildGame.terraNullius().id()),
    );
    slowBuildGame.addExecution(
      new AttackExecution(50, attacker2, slowBuildGame.terraNullius().id()),
    );

    for (let i = 0; i < 30; i++) {
      slowBuildGame.executeNextTick();
    }

    slowBuildGame.addExecution(
      new ConstructionExecution(
        defender2,
        UnitType.LandMine,
        slowBuildGame.ref(10, 10),
      ),
    );

    slowBuildGame.executeNextTick();
    slowBuildGame.executeNextTick();

    const mines = defender2.units(UnitType.LandMine);
    expect(mines).toHaveLength(1);
    const mine = mines[0];
    expect(mine.isUnderConstruction()).toBe(true);

    const mineTile = mine.tile();

    const attackerTilesBefore = attacker2.numTilesOwned();

    slowBuildGame.addExecution(
      new AttackExecution(100, attacker2, defender2.id()),
    );

    let ticks = 0;
    const maxTicks = 500;
    while (slowBuildGame.owner(mineTile) !== attacker2 && ticks < maxTicks) {
      slowBuildGame.executeNextTick();
      ticks++;
    }

    executeTicks(slowBuildGame, 5);

    expect(attacker2.numTilesOwned()).toBeGreaterThan(attackerTilesBefore - 20);
  });

  test("land mine should NOT explode when captured by ally", async () => {
    const allyInfo = new PlayerInfo("ally", PlayerType.Human, null, "ally_id");
    game.addPlayer(allyInfo);

    game.addExecution(
      new SpawnExecution(gameID, allyInfo, game.ref(10, 20)),
    );

    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    const ally = game.player(allyInfo.id);

    const allianceRequest = defender.createAllianceRequest(ally);
    if (allianceRequest) {
      allianceRequest.accept();
    }

    expect(defender.isAlliedWith(ally)).toBe(true);

    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];
    expect(mine).toBeDefined();

    const mineTile = mine.tile();

    ally.conquer(mineTile);

    executeTicks(game, 5);

    const allyTiles = ally.numTilesOwned();
    expect(allyTiles).toBeGreaterThan(0);
  });

  test("land mine detonation destroys the mine unit", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];
    const mineTile = mine.tile();

    game.addExecution(new AttackExecution(100, attacker, defender.id()));

    let ticks = 0;
    const maxTicks = 500;
    while (game.owner(mineTile) !== attacker && ticks < maxTicks) {
      game.executeNextTick();
      ticks++;
    }

    executeTicks(game, 5);

    expect(mine.isActive()).toBe(false);
    expect(defender.units(UnitType.LandMine)).toHaveLength(0);
  });

  test("land mine has same cost as defense post", async () => {
    const config = game.config();
    const landMineCost = config.unitInfo(UnitType.LandMine).cost(game, defender);
    const defensePostCost = config
      .unitInfo(UnitType.DefensePost)
      .cost(game, defender);

    expect(landMineCost).toEqual(defensePostCost);
  });

  test("land mine is a territory-bound structure", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];

    expect(mine.info().territoryBound).toBe(true);
  });

  test("land mine should not be visible to enemies", async () => {
    constructionExecution(game, defender, 10, 10, UnitType.LandMine);
    const mine = defender.units(UnitType.LandMine)[0];

    expect(mine.info().visibleToEnemies).toBe(false);
  });

  test("land mine visibility property is configured correctly in config", async () => {
    const config = game.config();
    const landMineInfo = config.unitInfo(UnitType.LandMine);

    expect(landMineInfo.visibleToEnemies).toBe(false);

    const defensePostInfo = config.unitInfo(UnitType.DefensePost);
    expect(defensePostInfo.visibleToEnemies).toBeUndefined();
  });

  test("server should not send land mine unit updates to enemies", async () => {
    game.addExecution(
      new ConstructionExecution(defender, UnitType.LandMine, game.ref(10, 10)),
    );

    let allUnitUpdates: UnitUpdate[] = [];
    for (let i = 0; i < 10; i++) {
      const updates: GameUpdates = game.executeNextTick();
      allUnitUpdates = allUnitUpdates.concat(updates[GameUpdateType.Unit]);
    }

    const mine = defender.units(UnitType.LandMine)[0];
    expect(mine).toBeDefined();

    const landMineUpdates = allUnitUpdates.filter(
      (u: UnitUpdate) => u.unitType === UnitType.LandMine,
    );
    expect(landMineUpdates.length).toBeGreaterThan(0);

    const attackerSmallID = attacker.smallID();

    const filteredForAttacker = allUnitUpdates.filter(
      (unitUpdate: UnitUpdate) => {
        const unitInfo = game.config().unitInfo(unitUpdate.unitType);

        if (unitInfo.visibleToEnemies !== false) {
          return true;
        }

        if (attackerSmallID === unitUpdate.ownerID) {
          return true;
        }

        const owner = game.playerBySmallID(unitUpdate.ownerID);
        if (owner.isPlayer() && attacker.isAlliedWith(owner)) {
          return true;
        }

        return false;
      },
    );

    const attackerLandMineUpdates = filteredForAttacker.filter(
      (u: UnitUpdate) => u.unitType === UnitType.LandMine,
    );
    expect(attackerLandMineUpdates).toHaveLength(0);

    const defenderSmallID = defender.smallID();

    const filteredForDefender = allUnitUpdates.filter(
      (unitUpdate: UnitUpdate) => {
        const unitInfo = game.config().unitInfo(unitUpdate.unitType);

        if (unitInfo.visibleToEnemies !== false) {
          return true;
        }

        if (defenderSmallID === unitUpdate.ownerID) {
          return true;
        }

        const owner = game.playerBySmallID(unitUpdate.ownerID);
        if (owner.isPlayer() && defender.isAlliedWith(owner)) {
          return true;
        }

        return false;
      },
    );

    const defenderLandMineUpdates = filteredForDefender.filter(
      (u: UnitUpdate) => u.unitType === UnitType.LandMine,
    );
    expect(defenderLandMineUpdates.length).toBeGreaterThan(0);
  });

  test("allied players should receive land mine updates from allies", async () => {
    const allyInfo = new PlayerInfo(
      "ally",
      PlayerType.Human,
      "ally_client",
      "ally_id",
    );
    game.addPlayer(allyInfo);

    game.addExecution(new SpawnExecution(gameID, allyInfo, game.ref(10, 20)));

    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    const ally = game.player(allyInfo.id);

    const allianceRequest = defender.createAllianceRequest(ally);
    if (allianceRequest) {
      allianceRequest.accept();
    }
    expect(defender.isAlliedWith(ally)).toBe(true);

    game.addExecution(
      new ConstructionExecution(defender, UnitType.LandMine, game.ref(10, 10)),
    );

    let allUnitUpdates: UnitUpdate[] = [];
    for (let i = 0; i < 10; i++) {
      const updates: GameUpdates = game.executeNextTick();
      allUnitUpdates = allUnitUpdates.concat(updates[GameUpdateType.Unit]);
    }

    const mine = defender.units(UnitType.LandMine)[0];
    expect(mine).toBeDefined();

    const landMineUpdates = allUnitUpdates.filter(
      (u: UnitUpdate) => u.unitType === UnitType.LandMine,
    );
    expect(landMineUpdates.length).toBeGreaterThan(0);

    const allySmallID = ally.smallID();

    const filteredForAlly = allUnitUpdates.filter((unitUpdate: UnitUpdate) => {
      const unitInfo = game.config().unitInfo(unitUpdate.unitType);

      if (unitInfo.visibleToEnemies !== false) {
        return true;
      }

      if (allySmallID === unitUpdate.ownerID) {
        return true;
      }

      const owner = game.playerBySmallID(unitUpdate.ownerID);
      if (owner.isPlayer() && ally.isAlliedWith(owner)) {
        return true;
      }

      return false;
    });

    const allyLandMineUpdates = filteredForAlly.filter(
      (u: UnitUpdate) => u.unitType === UnitType.LandMine,
    );
    expect(allyLandMineUpdates.length).toBeGreaterThan(0);
  });
});
