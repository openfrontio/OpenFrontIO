import { ColoredTeams, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { assignTeams } from "../src/core/game/TeamAssignment";

const teams = [ColoredTeams.Red, ColoredTeams.Blue];

describe("assignTeams", () => {
  const createPlayer = (id: string, clan?: string): PlayerInfo => {
    const name = clan ? `[${clan}]Player ${id}` : `Player ${id}`;
    return new PlayerInfo(
      "🏳️", // flag
      name,
      PlayerType.Human,
      null, // clientID (null for testing)
      id,
      null, // nation (null for testing)
    );
  };

  it("should assign players to teams when no clans are present", () => {
    const players = [
      createPlayer("1"),
      createPlayer("2"),
      createPlayer("3"),
      createPlayer("4"),
    ];

    const result = assignTeams(players, teams);

    // Check that players are assigned alternately
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
  });

  it("should keep clan members together on the same team", () => {
    const players = [
      createPlayer("1", "CLANA"),
      createPlayer("2", "CLANA"),
      createPlayer("3", "CLANB"),
      createPlayer("4", "CLANB"),
    ];

    const result = assignTeams(players, teams);

    // Check that clan members are on the same team
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
  });

  it("should handle mixed clan and non-clan players", () => {
    const players = [
      createPlayer("1", "CLANA"),
      createPlayer("2", "CLANA"),
      createPlayer("3"),
      createPlayer("4"),
    ];

    const result = assignTeams(players, teams);

    // Check that clan members are together and non-clan players balance teams
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
  });

  it("should kick players when teams are full", () => {
    const players = [
      createPlayer("1", "CLANA"),
      createPlayer("2", "CLANA"),
      createPlayer("3", "CLANA"),
      createPlayer("4", "CLANA"),
      createPlayer("5", "CLANB"),
      createPlayer("6", "CLANB"),
    ];

    const result = assignTeams(players, teams);

    // Check that players are kicked when teams are full
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);

    expect(result.get(players[3])).toEqual("kicked");

    expect(result.get(players[4])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[5])).toEqual(ColoredTeams.Blue);
  });

  it("should handle empty player list", () => {
    const result = assignTeams([], teams);
    expect(result.size).toBe(0);
  });

  it("should handle single player", () => {
    const players = [createPlayer("1")];
    const result = assignTeams(players, teams);
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
  });

  it("should handle multiple clans with different sizes", () => {
    const players = [
      createPlayer("1", "CLANA"),
      createPlayer("2", "CLANA"),
      createPlayer("3", "CLANA"),
      createPlayer("4", "CLANB"),
      createPlayer("5", "CLANB"),
      createPlayer("6", "CLANC"),
    ];

    const result = assignTeams(players, teams);

    // Check that larger clans are assigned first
    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[4])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[5])).toEqual(ColoredTeams.Blue);
  });

  it("should distribute players among a larger number of teams", () => {
    const players = [
      createPlayer("1", "CLANA"),
      createPlayer("2", "CLANA"),
      createPlayer("3", "CLANA"),
      createPlayer("4", "CLANB"),
      createPlayer("5", "CLANB"),
      createPlayer("6", "CLANC"),
      createPlayer("7"),
      createPlayer("8"),
      createPlayer("9"),
      createPlayer("10"),
      createPlayer("11"),
      createPlayer("12"),
      createPlayer("13"),
      createPlayer("14"),
    ];

    const result = assignTeams(players, [
      ColoredTeams.Red,
      ColoredTeams.Blue,
      ColoredTeams.Yellow,
      ColoredTeams.Green,
      ColoredTeams.Purple,
      ColoredTeams.Orange,
      ColoredTeams.Teal,
    ]);

    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual("kicked");
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[4])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[5])).toEqual(ColoredTeams.Yellow);
    expect(result.get(players[6])).toEqual(ColoredTeams.Green);
    expect(result.get(players[7])).toEqual(ColoredTeams.Purple);
    expect(result.get(players[8])).toEqual(ColoredTeams.Orange);
    expect(result.get(players[9])).toEqual(ColoredTeams.Teal);
    expect(result.get(players[10])).toEqual(ColoredTeams.Yellow);
    expect(result.get(players[11])).toEqual(ColoredTeams.Green);
    expect(result.get(players[12])).toEqual(ColoredTeams.Purple);
    expect(result.get(players[13])).toEqual(ColoredTeams.Orange);
  });
});
