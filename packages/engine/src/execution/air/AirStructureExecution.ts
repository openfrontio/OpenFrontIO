import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";

/**
 * AIR update: the running execution of an airbase or radar station.
 *
 * Neither acts on its own: aircraft refuel at airbases (AircraftExecution),
 * and defences and fighters ask the radar network whether a contact is
 * tracked (AirRules.isTrackedByRadar). The execution only follows the
 * structure's lifetime, like the other structures' executions.
 */
export class AirStructureExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(private structure: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (!this.structure.isActive()) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirStructureExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      structure: w.unit(this.structure),
    });
  }

  restoreSnapshot(s: AirStructureState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.structure = r.unit(s.structure);
  }
}

const AirStructureStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  structure: zRef(),
});
type AirStructureState = z.infer<typeof AirStructureStateSchema>;

export const AirStructureExecutionSnapshot = execSnapshotType({
  name: "AirStructure",
  version: 1,
  schema: AirStructureStateSchema,
  cls: () => AirStructureExecution,
});
