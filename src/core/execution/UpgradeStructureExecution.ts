import { Execution, Game, Player, Unit } from "../game/Game";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.structure = this.player
      .units()
      .find((unit) => unit.id() === this.unitId);

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }
    if (!this.structure.info().upgradable) {
      console.warn(`unit type ${this.structure} cannot be upgraded`);
      return;
    }
    this.cost = this.structure.info().cost(this.player);
    if (this.player.gold() < this.cost) {
      return;
    }
    this.player.upgradeUnit(this.structure);
    return;
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
