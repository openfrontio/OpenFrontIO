import { NukeExecution } from "../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let attacker: Player;
let silo: Unit;

describe("MissileSilo", () => {
  beforeEach(async () => {
    game = await setup("Plains", { infiniteGold: true, instantBuild: true }, [
      playerInfo("attacker_id", PlayerType.Human),
    ]);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");
    silo = attacker.buildUnit(UnitType.MissileSilo, game.ref(1, 1));
  });

  test("missilesilo should launch nuke", async () => {
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(7, 7));

    // Nuke should spawn on the silo.
    expect(nuke.tile()).toBe(game.map().ref(1, 1));

    game.addExecution(new NukeExecution(nuke));

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    // Nuke should have detonated at the target.
    expect(nuke.isActive()).toBeFalsy();
    expect(nuke.tile()).toBe(game.map().ref(7, 7));
  });

  test("missilesilo should only launch one nuke at a time", async () => {
    attacker.buildUnit(UnitType.AtomBomb, game.ref(7, 7));
    expect(attacker.canBuild(UnitType.AtomBomb, game.ref(7, 7))).toEqual(false);
  });

  test("missilesilo should cooldown as long as configured", async () => {
    expect(silo.isCooldown()).toEqual(false);

    // send the nuke far enough away so it doesnt destroy the silo
    game.addExecution(
      new NukeExecution(
        attacker.buildUnit(UnitType.AtomBomb, game.ref(50, 50)),
      ),
    );

    for (let i = 0; i < game.config().SiloCooldown() - 1; i++) {
      game.executeNextTick();
      expect(silo.isCooldown()).toEqual(true);
    }

    game.executeNextTick();
    expect(silo.isCooldown()).toEqual(false);
  });
});
