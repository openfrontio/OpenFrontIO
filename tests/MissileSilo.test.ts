import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { MirvExecution } from "../src/core/execution/MIRVExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

const gameID: GameID = "game_id";
let game: Game;
let attacker: Player;

function attackerBuildsNuke(
  source: TileRef | null,
  target: TileRef,
  initialize = true,
) {
  game.addExecution(
    new NukeExecution(UnitType.AtomBomb, attacker, target, source),
  );
  if (initialize) {
    game.executeNextTick();
    game.executeNextTick();
  }
}

describe("MissileSilo", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    const attacker_info = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(attacker_info.id).info(),
        game.ref(1, 1),
      ),
    );

    attacker = game.player("attacker_id");

    constructionExecution(game, attacker, 1, 1, UnitType.MissileSilo);
  });

  test("missilesilo should launch nuke", async () => {
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
    expect(attacker.units(UnitType.AtomBomb)[0].tile()).not.toBe(
      game.map().ref(7, 7),
    );

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("missilesilo should only launch one nuke at a time", async () => {
    attackerBuildsNuke(null, game.ref(7, 7));
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("missilesilo should cooldown as long as configured", async () => {
    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeFalsy();
    // send the nuke far enough away so it doesn't destroy the silo
    attackerBuildsNuke(null, game.ref(50, 50));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    for (let i = 0; i < game.config().SiloCooldown() - 2; i++) {
      game.executeNextTick();
      expect(
        attacker.units(UnitType.MissileSilo)[0].isInCooldown(),
      ).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeFalsy();
  });

  test("missilesilo should cooldown after launching MIRV", async () => {
    // MIRVs can only target player-owned tiles
    const target_info = new PlayerInfo(
      "target_id",
      PlayerType.Human,
      null,
      "target_id",
    );
    game.addPlayer(target_info);
    const target = game.player("target_id");
    target.conquer(game.ref(50, 50));

    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeFalsy();

    game.addExecution(new MirvExecution(attacker, game.ref(50, 50)));
    game.executeNextTick();
    game.executeNextTick();

    expect(attacker.units(UnitType.MIRV)).toHaveLength(1);
    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeTruthy();

    // the silo is on cooldown, so it cannot launch another nuke
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test.each([UnitType.AtomBomb, UnitType.HydrogenBomb])(
    "selected silo launches a %s instead of the nearest silo",
    (missileType) => {
      attacker.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
      const [selectedSilo, nearestSilo] = attacker.units(UnitType.MissileSilo);
      expect(selectedSilo.tile()).toBe(game.ref(1, 1));
      expect(nearestSilo.tile()).toBe(game.ref(20, 20));

      game.addExecution(
        new ConstructionExecution(
          attacker,
          missileType,
          game.ref(50, 50),
          undefined,
          selectedSilo.id(),
        ),
      );
      executeTicks(game, 4);

      expect(selectedSilo.isInCooldown()).toBe(true);
      expect(nearestSilo.isInCooldown()).toBe(false);
      expect(attacker.units(missileType)).toHaveLength(1);
    },
  );

  test("invalid selected silo rejects the launch instead of falling back", () => {
    const readySilo = attacker.units(UnitType.MissileSilo)[0];
    game.addExecution(
      new ConstructionExecution(
        attacker,
        UnitType.AtomBomb,
        game.ref(50, 50),
        undefined,
        999_999,
      ),
    );
    executeTicks(game, 4);

    expect(readySilo.isInCooldown()).toBe(false);
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("selected silo also launches a MIRV", () => {
    attacker.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
    const [selectedSilo, nearestSilo] = attacker.units(UnitType.MissileSilo);
    const targetInfo = new PlayerInfo(
      "mirv_target_id",
      PlayerType.Human,
      null,
      "mirv_target_id",
    );
    game.addPlayer(targetInfo);
    game.player(targetInfo.id).conquer(game.ref(50, 50));

    game.addExecution(
      new ConstructionExecution(
        attacker,
        UnitType.MIRV,
        game.ref(50, 50),
        undefined,
        selectedSilo.id(),
      ),
    );
    executeTicks(game, 4);

    expect(selectedSilo.isInCooldown()).toBe(true);
    expect(nearestSilo.isInCooldown()).toBe(false);
    expect(attacker.units(UnitType.MIRV)).toHaveLength(1);
  });

  test("missilesilo should have increased level after upgrade", async () => {
    expect(attacker.units(UnitType.MissileSilo)[0].level()).toEqual(1);

    const upgradeStructureExecution = new UpgradeStructureExecution(
      attacker,
      attacker.units(UnitType.MissileSilo)[0].id(),
    );
    game.addExecution(upgradeStructureExecution);
    executeTicks(game, 2);

    expect(attacker.units(UnitType.MissileSilo)[0].level()).toEqual(2);
  });
});
