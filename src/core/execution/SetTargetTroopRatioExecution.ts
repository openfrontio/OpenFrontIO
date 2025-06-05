import { Execution, Game, Player } from "../game/Game";

export class SetTargetTroopRatioExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private targetTroopsRatio: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this.targetTroopsRatio < 0 || this.targetTroopsRatio > 1) {
      console.warn(
        `target troop ratio of ${this.targetTroopsRatio} for player ${this.player} invalid`,
      );
    } else {
      this.player.setTargetTroopRatio(this.targetTroopsRatio);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
