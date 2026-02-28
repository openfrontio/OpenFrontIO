import { ColoredTeams, Execution, Game, GameMode, Team } from "../game/Game";

/**
 * Tracks team-level competitive metrics every 10 ticks:
 * - Crown ticks: accumulated time the leading team holds most tiles
 * - Peak tiles: highest tile count each team reaches during the match
 *
 * Only active in Team game mode.
 */
export class TeamMetricsExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  init(mg: Game, _ticks: number) {
    this.mg = mg;
    if (mg.config().gameConfig().gameMode !== GameMode.Team) {
      this.active = false;
    }
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) return;
    if (this.mg === null) throw new Error("Not initialized");

    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      if (team === null || team === ColoredTeams.Bot) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }

    // Track peak tiles for each team
    for (const [team, tiles] of teamToTiles) {
      this.mg.updateTeamPeakTiles(team, tiles);
    }

    // Track crown (team with most tiles)
    let maxTiles = 0;
    let crownTeam: Team | null = null;
    for (const [team, tiles] of teamToTiles) {
      if (tiles > maxTiles) {
        maxTiles = tiles;
        crownTeam = team;
      }
    }
    if (crownTeam !== null) {
      this.mg.addCrownTick(crownTeam, 10);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
