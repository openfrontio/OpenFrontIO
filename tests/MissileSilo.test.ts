import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { TileRef } from "../src/core/game/GameMap";

let game: Game;
let attacker: Player;

function attackerBuildsNuke(
  source: TileRef,
  target: TileRef,
  initialize = true,
) {
  game.addExecution(
    new NukeExecution(UnitType.AtomBomb, attacker.id(), target, source),
  );
  if (initialize) {
    game.executeNextTick();
    game.executeNextTick();
  }
}

describe("MissileSilo", () => {
  beforeEach(async () => {
    game = await setup("Plains", { infiniteGold: true, instantBuild: true });
    const attacker_info = new PlayerInfo(
      "fr",
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attacker_info, 1000);

    game.addExecution(
      new SpawnExecution(game.player(attacker_info.id).info(), game.ref(1, 1)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");

    constructionExecution(game, attacker.id(), 1, 1, UnitType.MissileSilo);
  });

  test("missilesilo should launch nuke", async () => {
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
    //because of initilization the nuke already moved so it should be at 204 when starting from 101
    expect(attacker.units(UnitType.AtomBomb)[0].tile()).toBe(
      game.map().ref(5, 1),
    );

    for (let i = 0; i < 3; i++) {
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
    expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeFalsy();
    // send the nuke far enough away so it doesnt destroy the silo
    attackerBuildsNuke(null, game.ref(50, 50));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    for (let i = 0; i < 24; i++) {
      game.executeNextTick();
    }
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);

    for (let i = 0; i < game.config().SiloCooldown() - 25; i++) {
      game.executeNextTick();
      expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeTruthy();
    }

    game.executeNextTick();
    expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeFalsy();
  });
});
