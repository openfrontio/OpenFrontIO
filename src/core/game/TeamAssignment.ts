import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { PlayerInfo, PlayerType, Team } from "./Game";

export function assignTeams(
  players: PlayerInfo[],
  teams: Team[],
  maxTeamSize: number = getMaxTeamSize(players.length, teams.length),
): Map<PlayerInfo, Team | "kicked"> {
  const result = new Map<PlayerInfo, Team | "kicked">();
  const teamPlayerCount = new Map<Team, number>();

  // Group players by party (highest priority), then clan, then no group
  const partyGroups = new Map<string, PlayerInfo[]>();
  const clanGroups = new Map<string, PlayerInfo[]>();
  const noGroupPlayers: PlayerInfo[] = [];

  // Sort players into party groups, clan groups, or no-group list
  for (const player of players) {
    if (player.partyCode) {
      // Party has highest priority
      if (!partyGroups.has(player.partyCode)) {
        partyGroups.set(player.partyCode, []);
      }
      partyGroups.get(player.partyCode)!.push(player);
    } else if (player.clan) {
      // Clan is second priority
      if (!clanGroups.has(player.clan)) {
        clanGroups.set(player.clan, []);
      }
      clanGroups.get(player.clan)!.push(player);
    } else {
      noGroupPlayers.push(player);
    }
  }

  // Sort parties by size (largest first)
  const sortedParties = Array.from(partyGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // Sort clans by size (largest first)
  const sortedClans = Array.from(clanGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // Helper function to assign a group of players to teams
  const assignGroup = (groupPlayers: PlayerInfo[]) => {
    // Find the team with the fewest players
    let team: Team | null = null;
    let teamSize = 0;
    for (const t of teams) {
      const p = teamPlayerCount.get(t) ?? 0;
      if (team !== null && teamSize <= p) continue;
      teamSize = p;
      team = t;
    }

    if (team === null) return;

    // Try to fit as many players as possible on the same team
    for (const player of groupPlayers) {
      if (teamSize < maxTeamSize) {
        teamSize++;
        result.set(player, team);
      } else {
        // If party/clan is larger than max team size, overflow to next team
        // Find the next team with space
        let overflowTeam: Team | null = null;
        let overflowSize = Infinity;
        for (const t of teams) {
          const p = teamPlayerCount.get(t) ?? 0;
          if (p < maxTeamSize && p < overflowSize) {
            overflowSize = p;
            overflowTeam = t;
          }
        }

        if (overflowTeam !== null && overflowSize < maxTeamSize) {
          result.set(player, overflowTeam);
          teamPlayerCount.set(overflowTeam, overflowSize + 1);
        } else {
          // No space in any team, kick the player
          result.set(player, "kicked");
        }
      }
    }
    teamPlayerCount.set(team, teamSize);
  };

  // First, assign party players (highest priority)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_, partyPlayers] of sortedParties) {
    assignGroup(partyPlayers);
  }

  // Second, assign clan players
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_, clanPlayers] of sortedClans) {
    assignGroup(clanPlayers);
  }

  // Finally, assign non-grouped players to balance teams
  let nationPlayers = noGroupPlayers.filter(
    (player) => player.playerType === PlayerType.FakeHuman,
  );
  if (nationPlayers.length > 0) {
    // Shuffle only nations to randomize their team assignment
    const random = new PseudoRandom(simpleHash(nationPlayers[0].id));
    nationPlayers = random.shuffleArray(nationPlayers);
  }
  const otherPlayers = noGroupPlayers.filter(
    (player) => player.playerType !== PlayerType.FakeHuman,
  );

  for (const player of otherPlayers.concat(nationPlayers)) {
    let team: Team | null = null;
    let teamSize = 0;
    for (const t of teams) {
      const p = teamPlayerCount.get(t) ?? 0;
      if (team !== null && teamSize <= p) continue;
      teamSize = p;
      team = t;
    }
    if (team === null) continue;
    teamPlayerCount.set(team, teamSize + 1);
    result.set(player, team);
  }

  return result;
}

export function assignTeamsLobbyPreview(
  players: PlayerInfo[],
  teams: Team[],
  nationCount: number,
): Map<PlayerInfo, Team | "kicked"> {
  const maxTeamSize = getMaxTeamSize(
    players.length + nationCount,
    teams.length,
  );
  return assignTeams(players, teams, maxTeamSize);
}

export function getMaxTeamSize(numPlayers: number, numTeams: number): number {
  return Math.ceil(numPlayers / numTeams);
}
