import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zNum, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { isDrivable } from "./ModMovement";

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
    // Cache the orderable units (warships, plus the tanks and fighter jets
    // that patrol the same way) and build a lookup map — avoids repeated
    // iteration
    const warshipMap = new Map(
      this.owner
        .units([UnitType.Warship, UnitType.Tank, UnitType.FighterJet])
        .map((u) => [u.id(), u]),
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
      if (warship.type() === UnitType.Tank) {
        // Tanks patrol on land they can drive on.
        if (!isDrivable(mg, this.position)) continue;
      } else if (warship.type() === UnitType.Warship) {
        // Do not update the warship's patrolTile if it is in a different Water Component
        if (
          !mg.hasWaterComponent(warship.tile(), newPatrolTileWaterComponent!)
        ) {
          continue;
        }
      }
      // Fighter jets fly anywhere.
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
