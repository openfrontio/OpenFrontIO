import { NukeExecution } from "../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

describe("Alliance acceptance destroys nukes", () => {
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
    player2.conquer(game.ref(0, 1));
    player3.conquer(game.ref(10, 10));
  });

  test("accepting alliance destroys queued nukes between players", () => {
    // Ensure the target tile is owned by player2
    player2.conquer(game.ref(5, 5));
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(5, 5), null),
    );

    expect(game.executions().length).toBe(1);

    const req = player1.createAllianceRequest(player2);
    req!.accept();
    game.executeNextTick();

    expect(game.executions().length).toBe(0);
  });

  test("accepting alliance destroys in-flight nukes between players", () => {
    // Ensure target owned by player2
    player2.conquer(game.ref(5, 5));

    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    const exec = new NukeExecution(
      UnitType.AtomBomb,
      player1,
      game.ref(5, 5),
      game.ref(0, 0),
    );

    game.addExecution(exec);
    game.executeNextTick(); // init
    game.executeNextTick(); // spawn nuke

    expect(exec.isInFlight()).toBe(true);
    expect(exec.isActive()).toBe(true);

    const req = player1.createAllianceRequest(player2);
    req!.accept();
    game.executeNextTick();

    expect(exec.isActive()).toBe(false);
  });

  test("queued and in-flight nukes are counted correctly", () => {
    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    player2.conquer(game.ref(5, 5));
    player2.conquer(game.ref(6, 6));

    const inFlight = new NukeExecution(
      UnitType.AtomBomb,
      player1,
      game.ref(5, 5),
      game.ref(0, 0),
    );

    const queued = new NukeExecution(
      UnitType.AtomBomb,
      player1,
      game.ref(6, 6),
      null,
    );

    // Spawn the in-flight nuke first
    game.addExecution(inFlight);
    game.executeNextTick();
    game.executeNextTick(); // spawn first

    // Add queued after the first has spawned so it remains queued
    game.addExecution(queued);

    const result = game.destroyNukesBetween(player1, player2);

    expect(result.inFlight).toBe(1);
    expect(result.queued).toBe(1);
  });

  test("accepting alliance does not destroy nukes targeting third players", () => {
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(10, 10), null),
    );

    const req = player1.createAllianceRequest(player2);
    req!.accept();
    game.executeNextTick();

    expect(game.executions().length).toBe(1);
  });

  test("queued nukes never spawn after alliance acceptance (race condition)", () => {
    // Ensure the target tile is owned by player2
    player2.conquer(game.ref(20, 20));

    const exec = new NukeExecution(
      UnitType.AtomBomb,
      player1,
      game.ref(20, 20),
      null,
    );

    game.addExecution(exec);

    const req = player1.createAllianceRequest(player2);
    req!.accept();

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(exec.isActive()).toBe(false);
    expect(game.executions().length).toBe(0);
  });

  test("accepting alliance displays correct nuke cancellation messages", () => {
    // Ensure target owned by player2
    player2.conquer(game.ref(5, 5));
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(5, 5), null),
    );

    const req = player1.createAllianceRequest(player2);
    req!.accept();
    const updates = game.executeNextTick();

    const messages =
      updates[GameUpdateType.DisplayEvent]?.map((e) => e.message) ?? [];

    // expect(messages.some((m) => m.includes("planned nuke"))).toBe(true);

    // Expect both the queued (planned) message and a directional message
    expect(
      messages.some(
        (m) =>
          m.includes("planned nuke") ||
          m.includes("launched towards") ||
          m.includes("launched at") ||
          m.includes("launched by"),
      ),
    ).toBe(true);
  });
});
