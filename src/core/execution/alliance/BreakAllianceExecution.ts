import { consolex } from "../../Consolex";
import { Execution, Game, Player } from "../../game/Game";

export class BreakAllianceExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private _owner: Player,
    private _target: Player,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const alliance = this._owner.allianceWith(this._target);
    if (alliance === null) {
      consolex.warn("cant break alliance, not allied");
    } else {
      this._owner.breakAlliance(alliance);
      this._target.updateRelation(this._owner, -200);
      for (const player of this.mg.players()) {
        if (player !== this._owner) {
          player.updateRelation(this._owner, -40);
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
