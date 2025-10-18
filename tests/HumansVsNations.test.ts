import { Game, GameMode, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;

describe("HumansVsNations Game Mode", () => {
  test("humans and nations are on separate teams", async () => {
    const humans = [
      playerInfo("human1", PlayerType.Human),
      playerInfo("human2", PlayerType.Human),
    ];

    game = await setup(
      "plains",
      {
        gameMode: GameMode.HumansVsNations,
        disableNPCs: false,
      },
      humans,
    );

    const human1 = game.player("human1");
    const human2 = game.player("human2");

    // All humans should be on the "Humans" team
    expect(human1.team()).toBe("Humans");
    expect(human2.team()).toBe("Humans");
    expect(human1.isOnSameTeam(human2)).toBe(true);
  });

  test("no bots spawn in HumansVsNations mode", async () => {
    game = await setup("plains", {
      gameMode: GameMode.HumansVsNations,
      bots: 10,
    });

    const players = game.players();
    const bots = players.filter((p) => p.type() === PlayerType.Bot);

    // No bots should be present
    expect(bots.length).toBe(0);
  });

  test("teams are correctly assigned", async () => {
    const humans = [
      playerInfo("human1", PlayerType.Human),
      playerInfo("human2", PlayerType.Human),
    ];

    game = await setup(
      "plains",
      {
        gameMode: GameMode.HumansVsNations,
      },
      humans,
    );

    const teams = game.teams();

    // Should have exactly 2 teams plus bot team
    expect(teams.length).toBe(3);
    expect(teams).toContain("Humans");
    expect(teams).toContain("Nations");
  });

  test("win condition uses team logic", async () => {
    const humans = [playerInfo("human1", PlayerType.Human)];

    game = await setup(
      "plains",
      {
        gameMode: GameMode.HumansVsNations,
      },
      humans,
    );

    // Game should use team-based win check
    expect(game.config().percentageTilesOwnedToWin()).toBe(95);
  });
});
