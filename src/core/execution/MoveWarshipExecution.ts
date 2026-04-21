import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitIds: number[],
    private readonly position: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    // Cache warship list and build a lookup map — avoids repeated iteration
    const warshipMap = new Map(
      this.owner.units(UnitType.Warship).map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each warship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const warship = warshipMap.get(unitId);
      if (!warship) {
        console.warn(`MoveWarshipExecution: warship ${unitId} not found`);
        continue;
      }
      if (!warship.isActive()) {
        console.warn(`MoveWarshipExecution: warship ${unitId} is not active`);
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
