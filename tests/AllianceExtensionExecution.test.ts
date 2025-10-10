import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

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
        playerInfo("player3", PlayerType.FakeHuman),
      ],
    );

    player1 = game.player("player1");
    player2 = game.player("player2");
    player3 = game.player("player3");

    while (game.inSpawnPhase()) {
      await game.executeNextTick();
    }
  });

  test("Successfully extends existing alliance between Humans", async () => {
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player2, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    await game.executeNextTick();
    await game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    await game.executeNextTick();
    await game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();
    expect(player2.allianceWith(player1)).toBeTruthy();

    const allianceBefore = player1.allianceWith(player2)!;
    const allianceSpy = jest.spyOn(allianceBefore, "extend");

    const expirationBefore = allianceBefore.expiresAt();

    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    await game.executeNextTick();
    expect(allianceSpy).toHaveBeenCalledTimes(0); // both players must agree to extend
    game.addExecution(new AllianceExtensionExecution(player2, player1.id()));
    await game.executeNextTick();

    const allianceAfter = player1.allianceWith(player2)!;

    expect(allianceAfter.id()).toBe(allianceBefore.id());

    const expirationAfter = allianceAfter.expiresAt();

    expect(expirationAfter).toBeGreaterThan(expirationBefore);
    expect(allianceSpy).toHaveBeenCalledTimes(1);
  });

  test("Fails gracefully if no alliance exists", async () => {
    game.addExecution(new AllianceExtensionExecution(player1, player2.id()));
    await game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeFalsy();
    expect(player2.allianceWith(player1)).toBeFalsy();
  });

  test("Successfully extends existing alliance between Human and non-Human", async () => {
    //test of handleAllianceExtensions is done in BotBehavior tests
    jest.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    jest.spyOn(player3, "isAlive").mockReturnValue(true);
    jest.spyOn(player1, "isAlive").mockReturnValue(true);

    game.addExecution(new AllianceRequestExecution(player1, player3.id()));
    await game.executeNextTick();
    await game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player3, true),
    );
    await game.executeNextTick();
    await game.executeNextTick();

    expect(player1.allianceWith(player3)).toBeTruthy();
    expect(player3.allianceWith(player1)).toBeTruthy();

    const allianceBefore = player1.allianceWith(player3)!;
    const allianceSpy = jest.spyOn(allianceBefore, "extend");
    const expirationBefore = allianceBefore.expiresAt();

    game.addExecution(new AllianceExtensionExecution(player1, player3.id()));
    await game.executeNextTick();
    expect(allianceSpy).toHaveBeenCalledTimes(0); // both players must agree to extend
    game.addExecution(new AllianceExtensionExecution(player3, player1.id()));
    await game.executeNextTick();

    const allianceAfter = player1.allianceWith(player3)!;

    expect(allianceAfter.id()).toBe(allianceBefore.id());

    const expirationAfter = allianceAfter.expiresAt();

    expect(expirationAfter).toBeGreaterThan(expirationBefore);
    expect(allianceSpy).toHaveBeenCalledTimes(1);
  });
});
