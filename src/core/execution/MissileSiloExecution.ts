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
  private mg: Game | null = null;
  private player: Player | null = null;
  private silo: Unit | null = null;

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
    if (this.player === null || this.mg === null) {
      throw new Error("Not initialized");
    }
    if (this.silo === null) {
      const spawn = this.player.canBuild(UnitType.MissileSilo, this.tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player} cannot build missile silo at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.silo = this.player.buildUnit(UnitType.MissileSilo, spawn, {
        cooldownDuration: this.mg.config().SiloCooldown(),
      });

      if (this.player !== this.silo.owner()) {
        this.player = this.silo.owner();
      }
    }

    const cooldown = this.silo.ticksLeftInCooldown();
    if (typeof cooldown === "number" && cooldown >= 0) {
      this.silo.touch();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
