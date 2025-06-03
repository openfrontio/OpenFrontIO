import { consolex } from "../../Consolex";
import { Execution, Game, Player } from "../../game/Game";

export class AllianceRequestExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this._owner.isFriendly(this._target)) {
      consolex.warn("already allied");
    } else if (!this._owner.canSendAllianceRequest(this._target)) {
      consolex.warn("recent or pending alliance request");
    } else {
      this._owner.createAllianceRequest(this._target);
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
