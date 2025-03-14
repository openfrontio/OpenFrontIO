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

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private player: Player;
  private silo: Unit;

  constructor(
    private _owner: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this._owner)) {
      console.warn(`MissileSiloExecution: owner ${this._owner} not found`);
      this.active = false;
      return;
    }

    this.mg = mg;
    this.player = mg.player(this._owner);
  }

  tick(ticks: number): void {
    if (this.silo == null) {
      if (!this.player.canBuild(UnitType.MissileSilo, this.tile)) {
        consolex.warn(
          `player ${this.player} cannot build missile silo at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.silo = this.player.buildUnit(UnitType.MissileSilo, 0, this.tile);
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
