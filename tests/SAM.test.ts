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
let defender: Player;

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

function defenderBuildsSam(x: number, y: number) {
  constructionExecution(game, defender.id(), x, y, UnitType.SAMLauncher);
}

describe("SAM", () => {
  beforeEach(async () => {
    game = await setup("Plains", { infiniteGold: true, instantBuild: true });
    const defender_info = new PlayerInfo(
      "us",
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    const attacker_info = new PlayerInfo(
      "fr",
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(defender_info, 1000);
    game.addPlayer(attacker_info, 1000);

    game.addExecution(
      new SpawnExecution(game.player(defender_info.id).info(), game.ref(1, 1)),
      new SpawnExecution(game.player(attacker_info.id).info(), game.ref(7, 7)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    defender = game.player("defender_id");
    attacker = game.player("attacker_id");

    constructionExecution(game, attacker.id(), 7, 7, UnitType.MissileSilo);
  });

  test("one sam should take down one nuke", async () => {
    defenderBuildsSam(1, 1);
    attackerBuildsNuke(game.ref(7, 7), game.ref(1, 1));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("sam should only get one nuke at a time", async () => {
    defenderBuildsSam(1, 1);
    attackerBuildsNuke(game.ref(7, 7), game.ref(1, 1), false);
    attackerBuildsNuke(game.ref(7, 7), game.ref(1, 1));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(2);

    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("sam should cooldown as long as configured", async () => {
    defenderBuildsSam(1, 1);
    expect(defender.units(UnitType.SAMLauncher)[0].isCooldown()).toBeFalsy();
    attackerBuildsNuke(game.ref(7, 7), game.ref(1, 1));
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    game.executeNextTick();
    game.executeNextTick();
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);

    for (let i = 0; i < game.config().SAMCooldown() - 2; i++) {
      game.executeNextTick();
      expect(defender.units(UnitType.SAMLauncher)[0].isCooldown()).toBeTruthy();
    }

    game.executeNextTick();
    expect(defender.units(UnitType.SAMLauncher)[0].isCooldown()).toBeFalsy();
  });

  test("two sams should not target twice same nuke", async () => {
    defenderBuildsSam(1, 1);
    defenderBuildsSam(1, 2);
    attackerBuildsNuke(game.ref(7, 7), game.ref(1, 1));

    expect(defender.units(UnitType.SAMLauncher)).toHaveLength(2);
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);

    game.executeNextTick();
    game.executeNextTick();

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
    const sams = defender.units(UnitType.SAMLauncher);
    // Only one sam must have shot
    expect(
      (sams[0].isCooldown() && !sams[1].isCooldown()) ||
        (sams[1].isCooldown() && !sams[0].isCooldown()),
    ).toBe(true);
  });
});
