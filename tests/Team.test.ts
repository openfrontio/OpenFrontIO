import {
  ColoredTeams,
  Game,
  GameMode,
  PlayerType,
} from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;

describe("Teams", () => {
  test("bots are on the same team, but can attack each other", async () => {
    game = await setup("Plains", { gameMode: GameMode.Team, playerTeams: 2 });

    const bot1 = game.addPlayer(playerInfo("bot1", PlayerType.Bot));
    const bot2 = game.addPlayer(playerInfo("bot2", PlayerType.Bot));

    // Both bots should be on the same team
    expect(bot1.team()).toBe(ColoredTeams.Bot);
    expect(bot2.team()).toBe(ColoredTeams.Bot);

    // But they should be allowed to attack each other.
    expect(bot1.isOnSameTeam(bot2)).toBe(false);
  });

  test("humans spawn on different teams", async () => {
    game = await setup(
      "Plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [
        playerInfo("human1", PlayerType.Human),
        playerInfo("human2", PlayerType.Human),
      ],
    );
    expect(game.player("human1").isOnSameTeam(game.player("human2"))).toBe(
      false,
    );
  });
});
