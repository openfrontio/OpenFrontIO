import { z } from "zod";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zNum, zPlayerRef } from "../snapshot/SnapshotType";

export class MoveWarshipExecution implements Execution {
  constructor(
    private owner: Player,
    private unitIds: number[],
    private position: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent = mg.getWaterComponent(this.position);
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
      // Do not update the warship's patrolTile if it is in a different Water Component
      if (!mg.hasWaterComponent(warship.tile(), newPatrolTileWaterComponent!)) {
        continue;
      }
      warship.updateWarshipState({
        patrolTile: this.position,
      });
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

  snapshot(w: SnapshotWriter): ExecRecord {
    return MoveWarshipExecutionSnapshot.write({
      owner: w.player(this.owner),
      unitIds: [...this.unitIds],
      position: this.position,
    });
  }

  restoreSnapshot(s: MoveWarshipState, r: SnapshotReader): void {
    this.owner = r.player(s.owner);
    this.unitIds = s.unitIds;
    this.position = s.position;
  }
}

// position is untrusted intent data (validated in init), so any number.
const MoveWarshipStateSchema = z.object({
  owner: zPlayerRef(),
  unitIds: z.array(zNum()),
  position: zNum(),
});
type MoveWarshipState = z.infer<typeof MoveWarshipStateSchema>;

export const MoveWarshipExecutionSnapshot = execSnapshotType({
  name: "MoveWarship",
  version: 1,
  schema: MoveWarshipStateSchema,
  cls: () => MoveWarshipExecution,
});
