import { consolex } from "../Consolex";
import { Execution, Game, Gold, Player } from "../game/Game";

export class DonateGoldExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
    private gold: Gold | null,
  ) {}

  init(mg: Game, ticks: number): void {
    if (this.gold === null) {
      this.gold = this._owner.gold() / 3n;
    }
  }

  tick(ticks: number): void {
    if (this.gold === null) throw new Error("not initialized");
    if (
      this._owner.canDonate(this._target) &&
      this._owner.donateGold(this._target, this.gold)
    ) {
      this._target.updateRelation(this._owner, 50);
    } else {
      consolex.warn(
        `cannot send gold from ${this._owner.name()} to ${this._target.name()}`,
      );
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
