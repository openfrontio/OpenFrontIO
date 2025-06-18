import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class OilWellExecution implements Execution {
  private mg: Game;
  private oilWell: Unit | null = null;
  private active: boolean = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.oilWell === null) {
      const spawnTile = this.player.canBuild(UnitType.OilWell, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build oil well");
        this.active = false;
        return;
      }
      this.oilWell = this.player.buildUnit(UnitType.OilWell, spawnTile, {});
    }
    if (!this.oilWell.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.oilWell.owner()) {
      this.player = this.oilWell.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
