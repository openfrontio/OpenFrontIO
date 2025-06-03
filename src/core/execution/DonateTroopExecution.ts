import { consolex } from "../Consolex";
import { Execution, Game, Player } from "../game/Game";

export class DonateTroopsExecution implements Execution {
  private active = true;

  constructor(
    private _owner: Player,
    private _target: Player,
    private troops: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    if (this.troops === null) {
      this.troops = mg.config().defaultDonationAmount(this._owner);
    }
    const maxDonation =
      mg.config().maxPopulation(this._target) - this._target.population();
    this.troops = Math.min(this.troops, maxDonation);
  }

  tick(ticks: number): void {
    if (this.troops === null) throw new Error("not initialized");
    if (
      this._owner.canDonate(this._target) &&
      this._owner.donateTroops(this._target, this.troops)
    ) {
      this._target.updateRelation(this._owner, 50);
    } else {
      consolex.warn(
        `cannot send troops from ${this._owner.name()} to ${this._target.name()}`,
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
