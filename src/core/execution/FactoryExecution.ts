import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  Unit,
  PlayerID,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class FactoryExecution implements Execution {
  private player: Player;
  private mg: Game;
  private factory: Unit;
  private active: boolean = true;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`FactoryExecution: player ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.factory == null) {
      const spawnTile = this.player.canBuild(UnitType.Factory, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build factory");
        this.active = false;
        return;
      }
      this.factory = this.player.buildUnit(UnitType.Factory, 0, spawnTile);
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
