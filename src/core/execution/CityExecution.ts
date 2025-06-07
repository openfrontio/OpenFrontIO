import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class CityExecution implements Execution {
  private mg: Game;
  private city: Unit | null = null;
  private active: boolean = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.city === null) {
      const spawnTile = this.player.canBuild(UnitType.City, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build city");
        this.active = false;
        return;
      }
      this.city = this.player.buildUnit(UnitType.City, spawnTile, {});
    }
    if (!this.city.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.city.owner()) {
      this.player = this.city.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
