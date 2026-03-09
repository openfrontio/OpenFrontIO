import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { ColoredTeams, PlayerInfo, PlayerType, Team } from "./Game";

export function assignTeams(
  players: PlayerInfo[],
  teams: Team[],
  maxTeamSize: number = getMaxTeamSize(players.length, teams.length),
): Map<PlayerInfo, Team | "kicked"> {
  const result = new Map<PlayerInfo, Team | "kicked">();
  const teamPlayerCount = new Map<Team, number>();

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

  // Sort clans by size (largest first)
  const sortedClans = Array.from(clanGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  // First, assign clan players
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [_, clanPlayers] of sortedClans) {
    // Try to keep the clan together on the team with fewer players
    let team: Team | null = null;
    let teamSize = 0;
    for (const t of teams) {
      const p = teamPlayerCount.get(t) ?? 0;
      if (team !== null && teamSize <= p) continue;
      teamSize = p;
      team = t;
    }

    if (team === null) continue;

    for (const player of clanPlayers) {
      if (teamSize < maxTeamSize) {
        teamSize++;
        result.set(player, team);
      } else {
        result.set(player, "kicked");
      }
    }
    teamPlayerCount.set(team, teamSize);
  }

  // Then, assign non-clan players to balance teams
  let nationPlayers = noClanPlayers.filter(
    (player) => player.playerType === PlayerType.Nation,
  );
  if (nationPlayers.length > 0) {
    // Shuffle only nations to randomize their team assignment
    const random = new PseudoRandom(simpleHash(nationPlayers[0].id));
    nationPlayers = random.shuffleArray(nationPlayers);
  }
  const otherPlayers = noClanPlayers.filter(
    (player) => player.playerType !== PlayerType.Nation,
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

  // Only rename numbered teams (8+ team mode), not colored teams
  const coloredTeamValues = Object.values(ColoredTeams);
  const isNumberedTeams = !teams.some((t) => coloredTeamValues.includes(t));

  if (isNumberedTeams) {
    // Build reverse map: team → assigned players
    const teamToPlayers = new Map<Team, PlayerInfo[]>();
    for (const [pi, team] of result.entries()) {
      if (team === "kicked") continue;
      if (!teamToPlayers.has(team)) teamToPlayers.set(team, []);
      teamToPlayers.get(team)!.push(pi);
    }

    // Compute candidate names
    const renameMap = new Map<Team, Team>();
    for (const [oldTeam, teamPlayers] of teamToPlayers.entries()) {
      const newName = computeClanTeamName(teamPlayers);
      if (newName !== null && newName !== oldTeam) {
        renameMap.set(oldTeam, newName);
      }
    }

    // Collision check: repeatedly remove renames that collide with existing
    // team names or with each other until no more removals occur.
    let changed = true;
    while (changed) {
      changed = false;
      const existingNames = new Set(teams.filter((t) => !renameMap.has(t)));
      const newNames = Array.from(renameMap.values());
      for (const [oldTeam, newName] of renameMap.entries()) {
        if (
          existingNames.has(newName) ||
          newNames.filter((n) => n === newName).length > 1
        ) {
          renameMap.delete(oldTeam);
          changed = true;
        }
      }
    }

    // Apply renames to teams array in-place (preserves index order for teamSpawnArea)
    for (let i = 0; i < teams.length; i++) {
      teams[i] = renameMap.get(teams[i]) ?? teams[i];
    }

    // Apply renames to result map
    for (const [pi, team] of result.entries()) {
      if (team !== "kicked" && renameMap.has(team)) {
        result.set(pi, renameMap.get(team)!);
      }
    }
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

export function computeClanTeamName(players: PlayerInfo[]): string | null {
  const humans = players.filter((p) => p.playerType === PlayerType.Human);
  if (humans.length === 0) return null;

  const clanCounts = new Map<string, number>();
  for (const player of humans) {
    if (player.clan !== null) {
      clanCounts.set(player.clan, (clanCounts.get(player.clan) ?? 0) + 1);
    }
  }
  if (clanCounts.size === 0) return null;

  const sorted = Array.from(clanCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const [topTag, topCount] = sorted[0];
  const total = humans.length;

  // Unanimous or majority
  if (topCount / total > 0.5) return topTag;

  // Coalition: top two clans cover the majority of humans
  if (sorted.length >= 2) {
    const [secondTag, secondCount] = sorted[1];
    if (
      (topCount + secondCount) / total > 2 / 3 &&
      secondCount / total >= 0.25
    ) {
      return `${topTag} / ${secondTag}`;
    }
  }

  return null;
}
