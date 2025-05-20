import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

let game: Game;
let attacker: Player;
let defender: Player;

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
    game.addPlayer(defender_info);
    game.addPlayer(attacker_info);

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
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender.id(), null, sam));
    attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {});

    executeTicks(game, 3);

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("sam should only get one nuke at a time", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender.id(), null, sam));
    attacker.buildUnit(UnitType.AtomBomb, game.ref(2, 1), {
      detonationDst: game.ref(2, 1),
    });
    attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 2), {
      detonationDst: game.ref(1, 2),
    });
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(2);

    executeTicks(game, 3);

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(1);
  });

  test("sam should cooldown as long as configured", async () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    game.addExecution(new SAMLauncherExecution(defender.id(), null, sam));
    expect(sam.isInCooldown()).toBeFalsy();
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 2), {
      detonationDst: game.ref(1, 2),
    });

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();
    for (let i = 0; i < game.config().SAMCooldown() - 3; i++) {
      game.executeNextTick();
      expect(sam.isInCooldown()).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(sam.isInCooldown()).toBeFalsy();
  });

  test("two sams should not target twice same nuke", async () => {
    const sam1 = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {
      cooldownDuration: 10,
    });
    game.addExecution(new SAMLauncherExecution(defender.id(), null, sam1));
    const sam2 = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 2), {});
    game.addExecution(new SAMLauncherExecution(defender.id(), null, sam2));
    const nuke = attacker.buildUnit(UnitType.AtomBomb, game.ref(2, 2), {
      detonationDst: game.ref(2, 2),
    });

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();
    expect([sam1, sam2].filter((s) => s.isInCooldown())).toHaveLength(1);
  });
});
