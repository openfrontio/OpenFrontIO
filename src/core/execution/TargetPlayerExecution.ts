import { Execution, Game, Player, TerraNullius } from "../game/Game";

export class TargetPlayerExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player | TerraNullius,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    if (this._target.isPlayer() && this._owner.canTarget(this._target)) {
      this._owner.target(this._target);
      this._target.updateRelation(this._owner, -40);
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
