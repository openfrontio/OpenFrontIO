import { AllianceRequestExecution } from "src/core/execution/alliance/AllianceRequestExecution";
import { GameUpdateType } from "src/core/game/GameUpdates";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

describe("Alliance acceptance immediately destroys in-flight nukes", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: true,
        instantBuild: true,
        infiniteTroops: true,
      },
      [
        new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
        new PlayerInfo("player3", PlayerType.Human, "c3", "p3"),
      ],
    );

    (game.config() as TestConfig).nukeAllianceBreakThreshold = () => 0;

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("p1");
    player2 = game.player("p2");
    player3 = game.player("p3");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(5, 5));
    player3.conquer(game.ref(10, 10));

    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});
  });

  test("accepting alliance destroys in-flight nukes between the newly allied players", () => {
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        player1,
        game.ref(5, 5),
        game.ref(0, 0),
        -1,
        5,
      ),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // spawn nuke

    expect(game.units(UnitType.AtomBomb)).toHaveLength(1);

    expect(player2.isAlliedWith(player1)).toBe(false);
    expect(player1.isFriendly(player2)).toBe(false);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick(); // counter-request auto-accepts

    expect(player2.isAlliedWith(player1)).toBe(true);
    expect(player1.isFriendly(player2)).toBe(true);

    expect(game.units(UnitType.AtomBomb)).toHaveLength(0);
  });

  test("accepting alliance destroys only nukes between allied players", () => {
    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(5, 5), null),
    );
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(10, 10), null),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // spawn nukes

    expect(game.units(UnitType.AtomBomb)).toHaveLength(2);

    expect(player2.isAlliedWith(player1)).toBe(false);
    expect(player1.isFriendly(player2)).toBe(false);

    // Both requests added in same tick so the nuke tick can't revoke the first
    // before the counter-request sees it.
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick(); // both init: first creates request, second auto-accepts

    expect(player2.isAlliedWith(player1)).toBe(true);
    expect(player1.isFriendly(player2)).toBe(true);

    expect(game.units(UnitType.AtomBomb)).toHaveLength(1);

    // Ensure remaining nuke targets player3
    const remainingNuke = game.units(UnitType.AtomBomb)[0];
    expect(remainingNuke.targetTile()).toBe(game.ref(10, 10));
  });

  test("accepting alliance displays a nuke-cancellation display message", () => {
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        player1,
        game.ref(5, 5),
        game.ref(0, 0),
        -1,
        5,
      ),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // spawn nuke

    expect(game.units(UnitType.AtomBomb)).toHaveLength(1);

    expect(player2.isAlliedWith(player1)).toBe(false);
    expect(player1.isFriendly(player2)).toBe(false);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick(); // creates request
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    const updates = game.executeNextTick(); // counter-request auto-accepts

    expect(player2.isAlliedWith(player1)).toBe(true);
    expect(player1.isFriendly(player2)).toBe(true);

    expect(game.units(UnitType.AtomBomb)).toHaveLength(0);

    const messages =
      updates[GameUpdateType.DisplayEvent]?.map((e) => e.message) ?? [];

    expect(
      messages.some(
        (m) =>
          m === "events_display.alliance_nukes_destroyed_outgoing" ||
          m === "events_display.alliance_nukes_destroyed_incoming",
      ),
    ).toBe(true);
  });
});
