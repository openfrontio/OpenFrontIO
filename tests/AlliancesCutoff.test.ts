import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

let game: Game;
let player1: Player;
let player2: Player;

describe("AlliancesCutoff", () => {
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

  test("alliances blocked after cutoff tick", () => {
    const cutoffTick = game.ticks() + 10;
    (game.config() as TestConfig).setAlliancesCutoffTick(cutoffTick);

    vi.spyOn(player1, "isAlive").mockReturnValue(true);
    vi.spyOn(player2, "isAlive").mockReturnValue(true);

    expect(player1.canSendAllianceRequest(player2)).toBe(true);

    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(game.ticks()).toBe(cutoffTick);
    expect(player1.canSendAllianceRequest(player2)).toBe(false);
  });

  test("existing alliances expire at cutoff tick", () => {
    const cutoffTick = game.ticks() + 20;
    (game.config() as TestConfig).setAlliancesCutoffTick(cutoffTick);

    vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(player2, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(player1, "isAlive").mockReturnValue(true);
    vi.spyOn(player2, "isAlive").mockReturnValue(true);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.allianceWith(player2)).toBeTruthy();

    while (game.ticks() < cutoffTick) {
      game.executeNextTick();
    }

    game.executeNextTick();
    expect(player1.allianceWith(player2)).toBeFalsy();
  });

  test("no cutoff when set to null", () => {
    (game.config() as TestConfig).setAlliancesCutoffTick(null);

    vi.spyOn(player1, "isAlive").mockReturnValue(true);
    vi.spyOn(player2, "isAlive").mockReturnValue(true);

    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
    }

    expect(player1.canSendAllianceRequest(player2)).toBe(true);
  });
});
