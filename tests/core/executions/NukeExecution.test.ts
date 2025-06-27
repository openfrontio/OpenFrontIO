import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;

describe("NukeExecution", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    (game.config() as TestConfig).nukeMagnitudes = jest.fn(() => ({
      inner: 10,
      outer: 10,
    }));
    const player_info = new PlayerInfo(
      undefined,
      "us",
      "player_id",
      PlayerType.Human,
      null,
      "player_id",
    );
    game.addPlayer(player_info);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
  });

  test("nuke should destroy buildings and redraw out of range buildings", async () => {
    // Build a city at (1,1)
    player.buildUnit(UnitType.City, game.ref(1, 1), {});
    // Build a missile silo in range
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 10), {});
    // Build a SAM out of range
    const sam = player.buildUnit(UnitType.SAMLauncher, game.ref(1, 11), {});
    sam.touch = jest.fn();
    // Build a Defense post out of range AND out of redraw range
    const defensePost = player.buildUnit(
      UnitType.DefensePost,
      game.ref(1, 27),
      {},
    );
    defensePost.touch = jest.fn();
    // Add a nuke execution targeting the city
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(1, 1),
      game.ref(1, 2),
    );
    game.addExecution(nukeExec);
    // Run enough ticks for the nuke to detonate
    executeTicks(game, 10);
    // The city and silo should be destroyed
    expect(player.units(UnitType.City)).toHaveLength(0);
    expect(player.units(UnitType.MissileSilo)).toHaveLength(0);
    expect(player.units(UnitType.SAMLauncher)).toHaveLength(1);
    expect(sam.touch).toHaveBeenCalled();
    expect(defensePost.touch).not.toHaveBeenCalled();
  });

  test("nuke should only be targetable near src and dst", async () => {
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(199, 199),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);
    // targetable distance is 400

    //near launch should be targetable (distance src < 400)
    executeTicks(game, 2);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();

    //mid air should not be targetable (distance src > 400, distance target > 400)
    executeTicks(game, 38);
    expect(nukeExec.getNuke()!.isTargetable()).toBeFalsy();

    //near target should be targetable (distance target < 400)
    executeTicks(game, 35);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();
  });
});
