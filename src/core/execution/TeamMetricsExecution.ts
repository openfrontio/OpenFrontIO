import { Execution, Game, GameMode } from "../game/Game";
import { computeTeamTiles, findCrownTeam } from "../game/TeamUtils";

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

    // Stop tracking after the game timer expires.
    const maxTimerValue = this.mg.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== undefined) {
      const elapsedSeconds =
        (ticks - this.mg.config().numSpawnPhaseTurns()) / 10;
      if (elapsedSeconds >= maxTimerValue * 60) return;
    }

    const teamToTiles = computeTeamTiles(this.mg.players());

    for (const [team, tiles] of teamToTiles) {
      this.mg.updateTeamPeakTiles(team, tiles);
    }

    const crownTeam = findCrownTeam(teamToTiles);
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
