import { ColoredTeams, Team } from "./Game";

/**
 * Any object that exposes a team and a tile count —
 * satisfied by both server-side `Player` and client-side `PlayerView`.
 */
interface HasTeamAndTiles {
  team(): Team | null;
  numTilesOwned(): number;
}

/**
 * Sums tile counts per team from the given players.
 * By default bots and null-team players are excluded.
 */
export function computeTeamTiles(
  players: Iterable<HasTeamAndTiles>,
  excludeBots = true,
): Map<Team, number> {
  const teamToTiles = new Map<Team, number>();
  for (const player of players) {
    const team = player.team();
    if (team === null) continue;
    if (excludeBots && team === ColoredTeams.Bot) continue;
    teamToTiles.set(
      team,
      (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
    );
  }
  return teamToTiles;
}

/**
 * Returns the team with the highest tile count, or `null` if the map is empty.
 */
export function findCrownTeam(teamToTiles: Map<Team, number>): Team | null {
  let maxTiles = 0;
  let crown: Team | null = null;
  for (const [team, tiles] of teamToTiles) {
    if (tiles > maxTiles) {
      maxTiles = tiles;
      crown = team;
    }
  }
  return crown;
}

/**
 * Converts raw crown-tick counts into display-friendly seconds.
 *
 * Non-crown-holder teams get `floor(ticks / 10)`.
 * The current crown holder receives the remainder so the total sums to
 * `totalElapsedSeconds`, keeping the sidebar timer and crown time in sync.
 */
export function normalizeCrownSeconds(
  allTeams: Team[],
  crownTicks: ReadonlyMap<Team, number>,
  crownHolder: Team | null,
  totalElapsedSeconds: number,
): Map<Team, number> {
  const result = new Map<Team, number>();
  let othersSum = 0;
  for (const team of allTeams) {
    const ticks = crownTicks.get(team) ?? 0;
    if (team !== crownHolder) {
      const secs = Math.floor(ticks / 10);
      result.set(team, secs);
      othersSum += secs;
    }
  }
  if (crownHolder !== null) {
    result.set(crownHolder, Math.max(0, totalElapsedSeconds - othersSum));
  }
  return result;
}
