import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { Game, Player, PlayerType, UnitType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;

describe("AllianceRequestExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: true,
        instantBuild: true,
        infiniteTroops: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
        playerInfo("player3", PlayerType.FakeHuman),
      ],
    );

    player1 = game.player("player1");
    player1.conquer(game.ref(0, 0));

    player2 = game.player("player2");
    player2.conquer(game.ref(0, 1));

    while (game.inSpawnPhase()) {
      await game.executeNextTick();
    }
  });

  test("Can create alliance by replying", async () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    await game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    await game.executeNextTick();
    await game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
  });

  test("Can create alliance by sending alliance request back", async () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    await game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    await game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
  });

  test("Alliance request expires", async () => {
    game.config().allianceRequestDuration = () => 5;
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    await game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);

    for (let i = 0; i < 6; i++) {
      await game.executeNextTick();
    }

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(player1.isAlliedWith(player2)).toBeFalsy();
    expect(player2.isAlliedWith(player1)).toBeFalsy();
  });

  // Resolves exploit https://github.com/openfrontio/OpenFrontIO/issues/2071
  test("alliance request is revoked immediately if requester launches a nuke", async () => {
    game.config().nukeAllianceBreakThreshold = () => 0;
    // Player 1 sends an alliance request to player 2.
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    await game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);
    expect(player2.incomingAllianceRequests().length).toBe(1);

    // Player 1 Builds a silo & launches a missle at player 2.
    constructionExecution(game, player1, 0, 0, UnitType.MissileSilo);
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player1, game.ref(0, 1), null),
    );
    await game.executeNextTick();
    await game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(player2.incomingAllianceRequests().length).toBe(0);
    expect(player1.isAlliedWith(player2)).toBeFalsy();
    expect(player2.isAlliedWith(player1)).toBeFalsy();
  });
});
