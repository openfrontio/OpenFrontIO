import { PlayerInfo, Team, TeamName } from "./Game";

export function assignTeams(
  players: PlayerInfo[],
): Map<PlayerInfo, Team | "kicked"> {
  const result = new Map<PlayerInfo, Team | "kicked">();
  let redTeamCount = 0;
  let blueTeamCount = 0;

  // Group players by clan
  const clanGroups = new Map<string, PlayerInfo[]>();
  const noClanPlayers: PlayerInfo[] = [];

  // Sort players into clan groups or no-clan list
  for (const player of players) {
    if (player.clan) {
      if (!clanGroups.has(player.clan)) {
        clanGroups.set(player.clan, []);
      }
      clanGroups.get(player.clan)!.push(player);
    } else {
      noClanPlayers.push(player);
    }
  }

  const maxTeamSize = Math.ceil(players.length / 2);

  // Sort clans by size (largest first)
  const sortedClans = Array.from(clanGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // First, assign clan players
  for (const [_, clanPlayers] of sortedClans) {
    // Try to keep the clan together on the team with fewer players
    if (redTeamCount <= blueTeamCount) {
      // Assign to red team
      for (const player of clanPlayers) {
        if (redTeamCount < maxTeamSize) {
          redTeamCount++;
          result.set(player, { name: TeamName.Red });
        } else {
          result.set(player, "kicked");
        }
      }
    } else {
      // Assign to blue team
      for (const player of clanPlayers) {
        if (blueTeamCount < maxTeamSize) {
          blueTeamCount++;
          result.set(player, { name: TeamName.Blue });
        } else {
          result.set(player, "kicked");
        }
      }
    }
  }

  // Then, assign non-clan players to balance teams
  for (const player of noClanPlayers) {
    if (redTeamCount <= blueTeamCount) {
      redTeamCount++;
      result.set(player, { name: TeamName.Red });
    } else {
      blueTeamCount++;
      result.set(player, { name: TeamName.Blue });
    }
  }

  return result;
}
