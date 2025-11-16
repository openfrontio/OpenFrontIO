import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { RevokeAllianceRequestExecution } from "../src/core/execution/alliance/RevokeAllianceRequestExecution";
import { Game, MessageType, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("RevokeAllianceRequestExecution", () => {
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

  test("Can revoke pending alliance request", () => {
    // Player1 sends an alliance request to player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(1);
    expect(player2.incomingAllianceRequests().length).toBe(1);

    // Player1 revokes the request
    game.addExecution(
      new RevokeAllianceRequestExecution(player1, player2.id()),
    );
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(player2.incomingAllianceRequests().length).toBe(0);
    expect(player1.isAlliedWith(player2)).toBeFalsy();
    expect(player2.isAlliedWith(player1)).toBeFalsy();
  });

  test("Sends message to recipient when request is revoked", () => {
    // Player1 sends an alliance request to player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    // Spy on displayMessage to verify it's called
    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Player1 revokes the request
    game.addExecution(
      new RevokeAllianceRequestExecution(player1, player2.id()),
    );
    game.executeNextTick();

    // Verify message was sent to player2
    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.alliance_request_revoked",
      MessageType.ALLIANCE_REJECTED,
      player2.id(),
      undefined,
      { name: player1.displayName() },
    );
    expect(displayMessageSpy).toHaveBeenCalledTimes(1);

    displayMessageSpy.mockRestore();
  });

  test("Does nothing if no pending request exists", () => {
    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Try to revoke a request that doesn't exist
    game.addExecution(
      new RevokeAllianceRequestExecution(player1, player2.id()),
    );
    game.executeNextTick();

    expect(player1.outgoingAllianceRequests().length).toBe(0);
    expect(displayMessageSpy).not.toHaveBeenCalled();

    displayMessageSpy.mockRestore();
  });

  test("Cannot revoke already accepted request", () => {
    // Create an alliance first
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    const request = player1.outgoingAllianceRequests()[0];
    request.accept();
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player1.outgoingAllianceRequests().length).toBe(0);

    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Try to revoke - should do nothing since request is already accepted
    game.addExecution(
      new RevokeAllianceRequestExecution(player1, player2.id()),
    );
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(displayMessageSpy).not.toHaveBeenCalled();

    displayMessageSpy.mockRestore();
  });
});
