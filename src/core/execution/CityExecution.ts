import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

export class CityExecution implements Execution {
  private player: Player;
  private mg: Game;
  private city: Unit;
  private active: boolean = true;

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`CityExecution: player ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.city == null) {
      const spawnTile = this.player.canBuild(UnitType.City, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build city");
        this.active = false;
        return;
      }
      this.city = this.player.buildUnit(UnitType.City, 0, spawnTile);
    }
    if (!this.city.isActive()) {
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
