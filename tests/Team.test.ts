import {
  ColoredTeams,
  Game,
  GameMode,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;

describe("Teams", () => {
  test("bots are on the same team, but can attack each other", async () => {
    game = await setup("plains", { gameMode: GameMode.Team, playerTeams: 2 });

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
      "plains",
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

  test("humans with pinned teamIndex get the matcher's exact split", async () => {
    // Matchmade 2v2: the server stamps teamIndex per player; the split
    // [h1,h4] vs [h2,h3] must survive full game construction.
    const pinned = (name: string, teamIndex: number) =>
      new PlayerInfo(
        name,
        PlayerType.Human,
        name,
        name,
        false,
        null,
        [],
        teamIndex,
      );
    game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
      },
      [pinned("h1", 0), pinned("h2", 1), pinned("h3", 1), pinned("h4", 0)],
    );

    expect(game.player("h1").team()).toBe(ColoredTeams.Red);
    expect(game.player("h2").team()).toBe(ColoredTeams.Blue);
    expect(game.player("h3").team()).toBe(ColoredTeams.Blue);
    expect(game.player("h4").team()).toBe(ColoredTeams.Red);
  });
});
