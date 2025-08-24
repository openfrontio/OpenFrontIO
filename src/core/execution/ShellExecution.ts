import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AirPathFinder } from "../pathfinding/PathFinding";

export class ShellExecution implements Execution {
  private active = true;
  private pathFinder: AirPathFinder | undefined;
  private shell: Unit | undefined;
  private mg: Game | undefined;
  private destroyAtTick = -1;
  private random: PseudoRandom | undefined;

  constructor(
    private readonly spawn: TileRef,
    private readonly _owner: Player,
    private readonly ownerUnit: Unit,
    private readonly target: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
  }

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.pathFinder === undefined) throw new Error("Not initialized");
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
      const result = this.pathFinder.nextTile(
        this.shell.tile(),
        this.target.tile(),
      );
      if (result === true) {
        this.active = false;
        this.target.modifyHealth(-this.effectOnTarget(), this._owner);
        this.shell.setReachedTarget();
        this.shell.delete(false);
        return;
      } else {
        this.shell.move(result);
      }
    }
  }

  private effectOnTarget(): number {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.random === undefined) throw new Error("Not initialized");
    const { damage } = this.mg.config().unitInfo(UnitType.Shell);
    const baseDamage = damage ?? 250;

    const roll = this.random.nextInt(1, 6);
    const damageMultiplier = (roll - 1) * 25 + 200;

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
