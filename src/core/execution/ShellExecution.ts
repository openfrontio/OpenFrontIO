import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";

export class ShellExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private shell: Unit | undefined;
  private mg: Game;
  private destroyAtTick: number = -1;
  private random: PseudoRandom;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
  }

  tick(ticks: number): void {
    this.shell ??= this._owner.buildUnit(UnitType.Shell, this.spawn, {});
    if (!this.shell.isActive()) {
      this.active = false;
      return;
    }
    if (
      !this.target.isActive() ||
      this.target.owner() === this.shell.owner() ||
      (this.destroyAtTick !== -1 && this.mg.ticks() >= this.destroyAtTick)
    ) {
      this.shell.delete(false);
      this.active = false;
      return;
    }

    if (this.destroyAtTick === -1 && !this.ownerUnit.isActive()) {
      this.destroyAtTick = this.mg.ticks() + this.mg.config().shellLifetime();
    }

    for (let i = 0; i < 3; i++) {
      const result = this.pathFinder.next(
        this.shell.tile(),
        this.target.tile(),
      );
      if (result.status === PathStatus.COMPLETE) {
        this.active = false;
        const targetType = this.target.type();
        const targetWasActive = this.target.isActive();
        this.target.modifyHealth(-this.effectOnTarget(), this._owner);
        // Award veterancy to the firing warship when this shell lands the
        // killing blow on an enemy warship or transport ship.
        if (
          targetWasActive &&
          !this.target.isActive() &&
          this.ownerUnit.isActive() &&
          this.ownerUnit.type() === UnitType.Warship
        ) {
          this.ownerUnit.recordKill(targetType);
        }
        this.shell.setReachedTarget();
        this.shell.delete(false);
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.shell.move(result.node);
      }
    }
  }

  private effectOnTarget(): number {
    const { damage } = this.mg.config().unitInfo(UnitType.Shell);
    const baseDamage = damage ?? 250;

    const roll = this.random.nextInt(1, 6);
    let damageMultiplier = (roll - 1) * 25 + 200;

    // Veteran warships hit harder — scale the (integer) multiplier by the firing
    // unit's veterancy. Integer percent math keeps src/core float-free.
    const veterancy = this.ownerUnit.veterancy();
    if (veterancy > 0) {
      const bonusPercent = this.mg.config().warshipVeterancyShellDamageBonus();
      damageMultiplier = Math.floor(
        (damageMultiplier * (100 + veterancy * bonusPercent)) / 100,
      );
    }

    return Math.round((baseDamage / 250) * damageMultiplier);
  }

  public getEffectOnTargetForTesting(): number {
    return this.effectOnTarget();
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
