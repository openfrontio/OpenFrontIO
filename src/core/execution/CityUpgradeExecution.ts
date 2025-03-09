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

export class CityUpgradeExecution implements Execution {
  private player: Player;
  private mg: Game;
  private cityUpgrde: Unit;
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
    if (this.cityUpgrde == null) {
      const spawnTile = this.player.canBuild(UnitType.CityUpgrade, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build cityUpgrde");
        this.active = false;
        return;
      }
      this.cityUpgrde = this.player.buildUnit(
        UnitType.CityUpgrade,
        0,
        spawnTile,
      );
    }
    if (!this.cityUpgrde.isActive()) {
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
