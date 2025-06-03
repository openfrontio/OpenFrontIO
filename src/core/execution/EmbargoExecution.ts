import { Execution, Game, Player } from "../game/Game";

export class EmbargoExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
    private readonly action: "start" | "stop",
  ) {}

  init(mg: Game, _: number): void {}

  tick(_: number): void {
    if (this.action === "start")
      this._owner.addEmbargo(this._target.id(), false);
    else this._owner.stopEmbargo(this._target.id());

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
