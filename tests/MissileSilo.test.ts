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
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

let game: Game;
let attacker: Player;

async function attackerBuildsNuke(
  source: TileRef | null,
  target: TileRef,
  initialize = true,
) {
  game.addExecution(
    new NukeExecution(UnitType.AtomBomb, attacker, target, source),
  );
  if (initialize) {
    await game.executeNextTick();
    await game.executeNextTick();
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
      new SpawnExecution(game.player(attacker_info.id).info(), game.ref(1, 1)),
    );

    while (game.inSpawnPhase()) {
      await game.executeNextTick();
    }

    attacker = game.player("attacker_id");

    await constructionExecution(game, attacker, 1, 1, UnitType.MissileSilo);
  });

  test("missilesilo should launch nuke", async () => {
    await attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
    expect(attacker.units(UnitType.AtomBomb)[0].tile()).not.toBe(
      game.map().ref(7, 7),
    );

    for (let i = 0; i < 5; i++) {
      await game.executeNextTick();
    }
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("missilesilo should only launch one nuke at a time", async () => {
    await attackerBuildsNuke(null, game.ref(7, 7));
    await attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("missilesilo should cooldown as long as configured", async () => {
    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeFalsy();
    // send the nuke far enough away so it doesnt destroy the silo
    await attackerBuildsNuke(null, game.ref(50, 50));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    for (let i = 0; i < game.config().SiloCooldown() - 2; i++) {
      await game.executeNextTick();
      expect(
        attacker.units(UnitType.MissileSilo)[0].isInCooldown(),
      ).toBeTruthy();
    }

    await executeTicks(game, 2);

    expect(attacker.units(UnitType.MissileSilo)[0].isInCooldown()).toBeFalsy();
  });

  test("missilesilo should have increased level after upgrade", async () => {
    expect(attacker.units(UnitType.MissileSilo)[0].level()).toEqual(1);

    const upgradeStructureExecution = new UpgradeStructureExecution(
      attacker,
      attacker.units(UnitType.MissileSilo)[0].id(),
    );
    game.addExecution(upgradeStructureExecution);
    await executeTicks(game, 2);

    expect(attacker.units(UnitType.MissileSilo)[0].level()).toEqual(2);
  });
});
