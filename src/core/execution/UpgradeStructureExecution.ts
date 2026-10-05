import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zNum, zPlayerRef, zRef } from "../snapshot/SnapshotType";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  constructor(
    private player: Player,
    private unitId: number,
    private amount: number = 1,
  ) {}

  init(mg: Game, ticks: number): void {
    this.structure = mg.unit(this.unitId);
    if (this.structure && this.structure.owner() !== this.player) {
      console.warn(`structure not owned by player`);
      this.structure = undefined;
    }

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }

    for (let i = 0; i < this.amount; i++) {
      if (!this.player.canUpgradeUnit(this.structure)) {
        if (i === 0) {
          console.warn(
            `[UpgradeStructureExecution] unit type ${this.structure.type()} cannot be upgraded`,
          );
        }
        break;
      }
      this.player.upgradeUnit(this.structure);
    }
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

  snapshot(w: SnapshotWriter): ExecRecord {
    return UpgradeStructureExecutionSnapshot.write({
      structure: this.structure === undefined ? null : w.unit(this.structure),
      player: w.player(this.player),
      unitId: this.unitId,
      amount: this.amount,
    });
  }

  restoreSnapshot(s: UpgradeStructureState, r: SnapshotReader): void {
    if (s.structure !== null) this.structure = r.unit(s.structure);
    this.player = r.player(s.player);
    this.unitId = s.unitId;
    this.amount = s.amount;
  }
}

// cost is declared but never assigned, so there is nothing to store for it.
const UpgradeStructureStateSchema = z.object({
  structure: zRef().nullable(),
  player: zPlayerRef(),
  unitId: zNum(),
  amount: zNum(),
});
type UpgradeStructureState = z.infer<typeof UpgradeStructureStateSchema>;

export const UpgradeStructureExecutionSnapshot = execSnapshotType({
  name: "UpgradeStructure",
  version: 1,
  schema: UpgradeStructureStateSchema,
  cls: () => UpgradeStructureExecution,
});
