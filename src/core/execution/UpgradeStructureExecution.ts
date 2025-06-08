import { Execution, Game, Player, Unit } from "../game/Game";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | null = null;
  private mg: Game;

  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.player = mg.player(this.player.id());
    if (this.structure === null) {
      this.structure =
        this.player.units(...[]).find((unit) => unit.id() === this.unitId) ??
        null;

      if (!this.structure) {
        return;
      }
      if (!this.mg.unitInfo(this.structure?.type())) {
        console.warn(`unit type ${this.structure} cannot be upgraded`);
        return;
      }
      this.cost = this.mg.unitInfo(this.structure?.type()).cost(this.player);
      if (this.player.gold() < this.cost) {
        return;
      }
      this.player.upgradeUnit(this.structure, {});
      return;
    }
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
