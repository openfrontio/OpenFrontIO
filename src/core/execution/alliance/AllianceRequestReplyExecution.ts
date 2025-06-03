import { consolex } from "../../Consolex";
import { Execution, Game, Player } from "../../game/Game";

export class AllianceRequestReplyExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
    private accept: boolean,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this._owner.isFriendly(this._target)) {
      consolex.warn("already allied");
    } else {
      const request = this._owner
        .outgoingAllianceRequests()
        .find((ar) => ar.recipient() === this._target);
      if (request === undefined) {
        consolex.warn("no alliance request found");
      } else {
        if (this.accept) {
          request.accept();
          this._owner.updateRelation(this._target, 100);
          this._target.updateRelation(this._owner, 100);
        } else {
          request.reject();
        }
      }
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
