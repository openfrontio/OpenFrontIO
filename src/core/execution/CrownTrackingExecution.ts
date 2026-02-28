import { Execution, Game, GameMode, Team } from "../game/Game";

/**
 * Tracks which team holds the "crown" (most total tiles) and accumulates
 * crown ticks per team for competition scoring.
 *
 * Crown time contributes 20% of a team's competition score.
 * Only active in Team game mode.
 */
export class CrownTrackingExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  init(mg: Game, _ticks: number) {
    this.mg = mg;
    // Only relevant in team mode
    if (mg.config().gameConfig().gameMode !== GameMode.Team) {
      this.active = false;
    }
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) return;
    if (this.mg === null) throw new Error("Not initialized");

    const crown = this.computeCrownTeam();
    if (crown !== null) {
      this.mg.addCrownTick(crown, 10);
    }
  }

  private computeCrownTeam(): Team | null {
    if (this.mg === null) return null;
    return this.mg.crownTeam();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
