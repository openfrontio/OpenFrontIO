import { describe, expect, test } from "vitest";
import {
  ColoredTeams,
  Game,
  GameMode,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Team,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("Core Simulation - Team Resolution and Assignment", () => {
  function playerTeamsOf(game: Game): Team[] {
    return game.teams().filter((t) => t !== ColoredTeams.Bot);
  }

  function createHuman(id: string, clanTag: string | null = null): PlayerInfo {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      `client_${id}`,
      `p_${id}`,
      false,
      clanTag,
    );
  }

  test("GameImpl resolves 2 teams and assigns post-conversion clan roster", async () => {
    // 5 CLAN members + 3 OTHER members initially (8 players, cap 4 on 2 teams).
    // Server benched 5th CLAN member, leaving 4 CLAN + 3 OTHER (7 active players).
    const clanPlayers = Array.from({ length: 4 }, (_, i) =>
      createHuman(`c${i}`, "CLAN"),
    );
    const otherPlayers = Array.from({ length: 3 }, (_, i) =>
      createHuman(`o${i}`, "OTHER"),
    );
    const postConversionRoster = [...clanPlayers, ...otherPlayers];

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
      postConversionRoster,
    );

    // GameImpl constructor must have called resolveTeamsList(2, 7)
    expect(playerTeamsOf(game)).toHaveLength(2);
    expect(playerTeamsOf(game)).toEqual([ColoredTeams.Red, ColoredTeams.Blue]);

    // All 7 players must be in the game (no simulation kicks)
    expect(game.allPlayers()).toHaveLength(7);

    // All 4 CLAN players must be together on Red
    for (const p of clanPlayers) {
      expect(game.player(p.id).team()).toBe(ColoredTeams.Red);
    }

    // All 3 OTHER players must be together on Blue
    for (const p of otherPlayers) {
      expect(game.player(p.id).team()).toBe(ColoredTeams.Blue);
    }
  });

  test("GameImpl dynamically resolves Quads team count for post-conversion roster", async () => {
    // 4 CLAN + 5 solos on 0-nation map with Quads.
    // Server benched 4th CLAN member because 9 players / 4 = 3 teams, cap 3.
    // Post-conversion active roster has 3 CLAN + 5 solos = 8 players.
    const clanPlayers = Array.from({ length: 3 }, (_, i) =>
      createHuman(`qc${i}`, "CLAN"),
    );
    const soloPlayers = Array.from({ length: 5 }, (_, i) =>
      createHuman(`qs${i}`),
    );
    const postConversionRoster = [...clanPlayers, ...soloPlayers];

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: Quads,
        nations: "disabled",
      },
      postConversionRoster,
    );

    // 8 players in Quads -> Math.ceil(8 / 4) = 2 teams (Red, Blue)
    expect(playerTeamsOf(game)).toHaveLength(2);
    expect(playerTeamsOf(game)).toEqual([ColoredTeams.Red, ColoredTeams.Blue]);

    // All 8 players must be placed without tick-0 kicks
    expect(game.allPlayers()).toHaveLength(8);

    // Clan members placed together on Red
    for (const p of clanPlayers) {
      expect(game.player(p.id).team()).toBe(ColoredTeams.Red);
    }
  });

  test("GameImpl resolves numbered teams when playerTeams >= 8", async () => {
    const players = Array.from({ length: 16 }, (_, i) => createHuman(`${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 8,
        nations: "disabled",
      },
      players,
    );

    expect(playerTeamsOf(game)).toHaveLength(8);
    expect(playerTeamsOf(game)).toEqual([
      "Team 1",
      "Team 2",
      "Team 3",
      "Team 4",
      "Team 5",
      "Team 6",
      "Team 7",
      "Team 8",
    ]);
    expect(game.allPlayers()).toHaveLength(16);
  });

  test("GameImpl resolves HumansVsNations teams", async () => {
    const humans = Array.from({ length: 4 }, (_, i) => createHuman(`h${i}`));

    const game = await setup(
      "plains",
      {
        gameMode: GameMode.Team,
        playerTeams: HumansVsNations,
        nations: 2,
      },
      humans,
    );

    expect(playerTeamsOf(game)).toEqual([
      ColoredTeams.Humans,
      ColoredTeams.Nations,
    ]);

    for (const h of humans) {
      expect(game.player(h.id).team()).toBe(ColoredTeams.Humans);
    }
  });
});
