import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitIds: number | number[],
    private readonly position: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    const ids = Array.isArray(this.unitIds) ? this.unitIds : [this.unitIds];
    for (const unitId of ids) {
      const warship = this.owner
        .units(UnitType.Warship)
        .find((u) => u.id() === unitId);
      if (!warship) {
        console.warn("MoveWarshipExecution: warship not found");
        continue;
      }
      if (!warship.isActive()) {
        console.warn("MoveWarshipExecution: warship is not active");
        continue;
      }
      warship.setPatrolTile(this.position);
      warship.setTargetTile(undefined);
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
