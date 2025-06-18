import {
  Execution,
  Game,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class FactoryExecution implements Execution {
  private player: Player | null = null;
  private factory: Unit | null = null;
  private active: boolean = true;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`FactoryExecution: player ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.player === null) {
      throw new Error("Not initialized");
    }

    if (this.factory === null) {
      const spawnTile = this.player.canBuild(UnitType.Factory, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build factory");
        this.active = false;
        return;
      }
      this.factory = this.player.buildUnit(UnitType.Factory, spawnTile, {});
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
