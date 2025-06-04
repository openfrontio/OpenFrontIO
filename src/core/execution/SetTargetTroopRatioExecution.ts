import { consolex } from "../Consolex";
import { Execution, Game, Player } from "../game/Game";

export class SetTargetTroopRatioExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private targetTroopsRatio: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this.targetTroopsRatio < 0 || this.targetTroopsRatio > 1) {
      consolex.warn(
        `target troop ratio of ${this.targetTroopsRatio} for player ${this._owner.id()} invalid`,
      );
    } else {
      this._owner.setTargetTroopRatio(this.targetTroopsRatio);
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
