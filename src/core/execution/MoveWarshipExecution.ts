import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    const warship = this.owner
      .units(UnitType.Warship)
      .find((u) => u.id() === this.unitId);
    if (!warship) {
      console.warn("MoveWarshipExecution: warship not found");
      return;
    }
    if (!warship.isActive()) {
      console.warn("MoveWarshipExecution: warship is not active");
      return;
    }
    warship.setPatrolTile(this.position);
    warship.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
