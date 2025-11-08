import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { RevokeAllianceExtensionExecution } from "../src/core/execution/alliance/RevokeAllianceExtensionExecution";
import { Game, MessageType, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("RevokeAllianceExtensionExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "ocean_and_land",
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
    player2 = game.player("player2");

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("Can revoke pending extension request", () => {
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player2, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    // Create alliance between player1 and player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();

    const alliance = player1.allianceWith(player2)!;

    // Player1 requests extension
    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    game.executeNextTick();

    expect(alliance.hasRequestedExtension(player1)).toBeTruthy();
    expect(alliance.onlyOneAgreedToExtend()).toBeTruthy();

    // Player1 revokes the extension request
    game.addExecution(
      new RevokeAllianceExtensionExecution(player1, player2.id()),
    );
    game.executeNextTick();

    expect(alliance.hasRequestedExtension(player1)).toBeFalsy();
    expect(alliance.onlyOneAgreedToExtend()).toBeFalsy();
  });

  test("Sends message to other player when extension request is revoked", () => {
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player2, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    // Create alliance between player1 and player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();

    // Player1 requests extension
    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    game.executeNextTick();

    // Spy on displayMessage to verify it's called
    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Player1 revokes the extension request
    game.addExecution(
      new RevokeAllianceExtensionExecution(player1, player2.id()),
    );
    game.executeNextTick();

    // Verify message was sent to player2
    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.alliance_extension_revoked",
      MessageType.RENEW_ALLIANCE,
      player2.id(),
      undefined,
      { name: player1.displayName() },
    );
    expect(displayMessageSpy).toHaveBeenCalledTimes(1);

    displayMessageSpy.mockRestore();
  });

  test("Does not send message if no extension request existed", () => {
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player2, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    // Create alliance between player1 and player2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();

    const alliance = player1.allianceWith(player2)!;
    expect(alliance.hasRequestedExtension(player1)).toBeFalsy();

    // Spy on displayMessage to verify it's NOT called
    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Try to revoke extension request that doesn't exist
    game.addExecution(
      new RevokeAllianceExtensionExecution(player1, player2.id()),
    );
    game.executeNextTick();

    // Should not send a message since there was no extension request
    expect(displayMessageSpy).not.toHaveBeenCalled();

    displayMessageSpy.mockRestore();
  });

  test("Fails gracefully if no alliance exists", () => {
    const displayMessageSpy = jest.spyOn(game, "displayMessage");

    // Try to revoke extension when no alliance exists
    game.addExecution(
      new RevokeAllianceExtensionExecution(player1, player2.id()),
    );
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeFalsy();
    expect(displayMessageSpy).not.toHaveBeenCalled();

    displayMessageSpy.mockRestore();
  });
});
