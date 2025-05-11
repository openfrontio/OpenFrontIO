import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let attacker: Player;

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
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(game.player(attacker_info.id).info(), game.ref(1, 1)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");

    attacker.buildUnit({
      type: UnitType.MissileSilo,
      dstTile: game.ref(1, 1),
    });
  });

  test("missilesilo should launch nuke", async () => {
    const nuke = attacker.buildUnit({
      type: UnitType.AtomBomb,
      dstTile: game.ref(7, 7),
      detonationDst: null,
    });
    expect(nuke.isActive()).toBe(true);
    expect(nuke.tile()).not.toBe(game.map().ref(7, 7));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }
    expect(nuke.isActive()).toBe(false);
  });

  test("missilesilo should only launch one nuke at a time", async () => {
    attacker.buildUnit({
      type: UnitType.AtomBomb,
      dstTile: game.ref(7, 7),
      detonationDst: null,
    });
    expect(attacker.canBuild(UnitType.AtomBomb, game.ref(7, 7))).toBeFalsy();
  });

  test("missilesilo should cooldown as long as configured", async () => {
    expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeFalsy();
    // send the nuke far enough away so it doesnt destroy the silo
    attacker.buildUnit({
      type: UnitType.AtomBomb,
      dstTile: game.ref(50, 50),
      detonationDst: null,
    });
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    for (let i = 0; i < game.config().SiloCooldown() - 1; i++) {
      game.executeNextTick();
      expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeTruthy();
    }

    game.executeNextTick();
    expect(attacker.units(UnitType.MissileSilo)[0].isCooldown()).toBeFalsy();
  });
});
