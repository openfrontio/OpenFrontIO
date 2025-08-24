import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";

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
      game.executeNextTick();
    }
  });

  test("Can create alliance by replying", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
  });

  test("Can create alliance by sending alliance request back", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
  });

  test("Alliance request expires", () => {
    game.config().allianceRequestDuration = () => 5;
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests()).toHaveLength(1);

    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
    }

    expect(player1.outgoingAllianceRequests()).toHaveLength(0);
    expect(player1.isAlliedWith(player2)).toBeFalsy();
    expect(player2.isAlliedWith(player1)).toBeFalsy();
  });
});
