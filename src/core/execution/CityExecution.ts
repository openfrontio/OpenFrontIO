import { consolex } from "../Consolex";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class CityExecution implements Execution {
  private mg: Game;
  private city: Unit | null = null;
  private active: boolean = true;

  constructor(
    private _owner: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.city === null) {
      const spawnTile = this._owner.canBuild(UnitType.City, this.tile);
      if (spawnTile === false) {
        consolex.warn("cannot build city");
        this.active = false;
        return;
      }
      this.city = this._owner.buildUnit(UnitType.City, spawnTile, {});
    }
    if (!this.city.isActive()) {
      this.active = false;
      return;
    }

    if (this._owner !== this.city.owner()) {
      this._owner = this.city.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
