import { jest } from "@jest/globals";

import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("AllianceExtensionExecution", () => {
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
      ],
    );

    player1 = game.player("player1");
    player2 = game.player("player2");

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("Successfully extends existing alliance", () => {
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player2, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();
    expect(player2.allianceWith(player1)).toBeTruthy();

    const allianceBefore = player1.allianceWith(player2)!;
    const allianceSpy = jest.spyOn(allianceBefore, "extend");
    const expirationBefore =
      allianceBefore.createdAt() + game.config().allianceDuration();

    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    game.executeNextTick();
    expect(allianceSpy).toHaveBeenCalledTimes(0); // both players must agree to extend
    game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
    game.executeNextTick();

    const allianceAfter = player1.allianceWith(player2)!;

    expect(allianceAfter.id()).toBe(allianceBefore.id());

    const expirationAfter =
      allianceAfter.createdAt() + game.config().allianceDuration();

    expect(expirationAfter).toBeGreaterThanOrEqual(expirationBefore);
    expect(allianceSpy).toHaveBeenCalledTimes(1);
  });

  test("Fails gracefully if no alliance exists", () => {
    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeFalsy();
    expect(player2.allianceWith(player1)).toBeFalsy();
  });
});
