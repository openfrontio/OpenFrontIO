import { consolex } from "../Consolex";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private silo: Unit | null = null;

  constructor(
    private _owner: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.silo === null) {
      const spawn = this._owner.canBuild(UnitType.MissileSilo, this.tile);
      if (spawn === false) {
        consolex.warn(
          `player ${this._owner.id()} cannot build missile silo at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.silo = this._owner.buildUnit(UnitType.MissileSilo, spawn, {
        cooldownDuration: this.mg.config().SiloCooldown(),
      });

      if (this._owner.id() !== this.silo.owner().id()) {
        this._owner = this.silo.owner();
      }
    }

    const cooldown = this.silo?.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.silo?.touch();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
