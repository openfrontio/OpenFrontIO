import { ColoredTeams, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { assignTeams } from "../src/core/game/TeamAssignment";

const teams = [ColoredTeams.Red, ColoredTeams.Blue];

describe("assignTeams", () => {
  const createPlayer = (id: string, clan?: string): PlayerInfo => {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      null, // clientID (null for testing)
      id,
      false,
      clan,
    );
  };

  // Friend grouping is keyed on clientID. By default we pass clientID = id
  // for brevity, but tests can override clientID to verify the lookup uses
  // clientID rather than PlayerInfo.id.
  const createPlayerWithFriends = (
    id: string,
    friends: string[],
    clan?: string,
    clientID: string = id,
  ): PlayerInfo => {
    return new PlayerInfo(
      `Player ${id}`,
      PlayerType.Human,
      clientID,
      id, // PlayerInfo.id
      false,
      clan,
      friends,
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

  it("should keep two friends on the same team", () => {
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", ["1"]),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
    ];

    const result = assignTeams(players, teams);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
    expect(result.get(players[2])).not.toEqual(result.get(players[0]));
    expect(result.get(players[3])).not.toEqual(result.get(players[0]));
  });

  it("should group a chain of friends transitively", () => {
    // 6 players, 2 teams → maxTeamSize = 3 (enough room for a 3-friend chain)
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", ["3"]),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
      createPlayerWithFriends("5", []),
      createPlayerWithFriends("6", []),
    ];

    const result = assignTeams(players, teams);

    const teamOf1 = result.get(players[0]);
    expect(result.get(players[1])).toEqual(teamOf1);
    expect(result.get(players[2])).toEqual(teamOf1);
  });

  it("should treat one-directional friendship as a group", () => {
    const players = [
      createPlayerWithFriends("1", ["2"]),
      createPlayerWithFriends("2", []), // doesn't list 1 back
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
    ];

    const result = assignTeams(players, teams);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
  });

  it("should merge friend and clan groups when they overlap", () => {
    // 1 and 2 share clan CLANA, 2 is friends with 3 (no clan)
    // → all three end up on the same team. 6 players, maxTeamSize = 3.
    const players = [
      createPlayerWithFriends("1", [], "CLANA"),
      createPlayerWithFriends("2", ["3"], "CLANA"),
      createPlayerWithFriends("3", [], undefined),
      createPlayerWithFriends("4", [], undefined),
      createPlayerWithFriends("5", [], undefined),
      createPlayerWithFriends("6", [], undefined),
    ];

    const result = assignTeams(players, teams);

    const teamOf1 = result.get(players[0]);
    expect(result.get(players[1])).toEqual(teamOf1);
    expect(result.get(players[2])).toEqual(teamOf1);
  });

  it("should spill friend-group overflow to other teams (no kicks)", () => {
    // 4-player friend group + 2 strangers, maxTeamSize = ceil(6/2) = 3.
    // Friend overflow spills to the other team rather than getting kicked.
    const players = [
      createPlayerWithFriends("1", ["2", "3", "4"]),
      createPlayerWithFriends("2", []),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
      createPlayerWithFriends("5", []),
      createPlayerWithFriends("6", []),
    ];

    const result = assignTeams(players, teams);

    expect(result.get(players[0])).toEqual(ColoredTeams.Red);
    expect(result.get(players[1])).toEqual(ColoredTeams.Red);
    expect(result.get(players[2])).toEqual(ColoredTeams.Red);
    expect(result.get(players[3])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[4])).toEqual(ColoredTeams.Blue);
    expect(result.get(players[5])).toEqual(ColoredTeams.Blue);
  });

  it("should key friend grouping on clientID, not PlayerInfo.id", () => {
    // clientID and PlayerInfo.id are distinct. The friends list references
    // clientIDs ("client-2", "client-1"). If grouping ever regressed to
    // keying on PlayerInfo.id ("player-1"/"player-2"), no edges would form
    // and these two would land on opposite teams.
    const players = [
      createPlayerWithFriends("player-1", ["client-2"], undefined, "client-1"),
      createPlayerWithFriends("player-2", ["client-1"], undefined, "client-2"),
      createPlayerWithFriends("player-3", [], undefined, "client-3"),
      createPlayerWithFriends("player-4", [], undefined, "client-4"),
    ];

    const result = assignTeams(players, teams);

    expect(result.get(players[0])).toEqual(result.get(players[1]));
    expect(result.get(players[2])).not.toEqual(result.get(players[0]));
    expect(result.get(players[3])).not.toEqual(result.get(players[0]));
  });

  it("should still kick when every team is at capacity", () => {
    // 5 friends in a clique, 2 teams, maxTeamSize = ceil(5/2) = 3.
    // Total capacity is 6, so we have slack — nobody should get kicked.
    // But if we force capacity below player count, kicks resume.
    const players = [
      createPlayerWithFriends("1", ["2", "3", "4", "5"]),
      createPlayerWithFriends("2", []),
      createPlayerWithFriends("3", []),
      createPlayerWithFriends("4", []),
      createPlayerWithFriends("5", []),
    ];

    const result = assignTeams(players, teams, 2);

    // maxTeamSize=2, 2 teams → capacity 4, 5 players → 1 must be kicked.
    const kicked = players.filter((p) => result.get(p) === "kicked");
    expect(kicked.length).toBe(1);
  });
});
