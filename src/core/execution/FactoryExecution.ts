import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class FactoryExecution implements Execution {
  private factory: Unit | null = null;
  private active: boolean = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const spawnTile = this.player.canBuild(UnitType.Factory, this.tile);
    if (spawnTile === false) {
      console.warn("cannot build factory");
      this.active = false;
      return;
    }
    this.factory = this.player.buildUnit(UnitType.Factory, spawnTile, {});
  }

  tick(ticks: number): void {
    if (this.factory === null) {
      throw new Error("Not initialized");
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.factory.owner()) {
      this.player = this.factory.owner();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
