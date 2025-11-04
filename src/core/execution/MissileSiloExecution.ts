import { Execution, Game, Player, Unit, UnitType, isUnit } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private silo: Unit | null = null;

  constructor(
    private playerOrUnit: Player | Unit,
    private tile?: TileRef
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.silo === null) {
      if (isUnit(this.playerOrUnit)) {
        this.silo = this.playerOrUnit;
      } else {
        const spawn = this.playerOrUnit.canBuild(
          UnitType.MissileSilo,
          this.tile!,
        );
        if (spawn === false) {
          console.warn(
            `player ${this.playerOrUnit} cannot build missile silo at ${this.tile}`,
          );
          this.active = false;
          return;
        }
        this.silo = this.playerOrUnit.buildUnit(UnitType.MissileSilo, spawn, {});

        if (this.playerOrUnit !== this.silo.owner()) {
          this.playerOrUnit = this.silo.owner();
        }
      }
    }

    if (this.silo.isUnderConstruction()) {
      return;
    }

    // frontTime is the time the earliest missile fired.
    const frontTime = this.silo.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().SiloCooldown() - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.silo.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
