import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Runs a finished offshore Oil Rig. Every oilRigCycleTicks it pays its owner
 * `oilRigGold(level)` and checks its supply line: a rig whose owner no longer
 * holds land within oilRigSupplyDistance is abandoned (destroyed).
 */
export class OilRigExecution implements Execution {
  private active = true;
  private mg: Game;
  private ticksUntilCycle = 0;

  constructor(private rig: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.ticksUntilCycle = mg.config().oilRigCycleTicks();
  }

  tick(ticks: number): void {
    if (!this.rig.isActive()) {
      this.active = false;
      return;
    }
    if (this.rig.isUnderConstruction()) {
      return;
    }
    if (--this.ticksUntilCycle > 0) {
      return;
    }
    this.ticksUntilCycle = this.mg.config().oilRigCycleTicks();

    const owner = this.rig.owner();
    if (
      !owner.isAlive() ||
      !owner.hasOwnLandWithin(
        this.rig.tile(),
        this.mg.config().oilRigSupplyDistance(),
      )
    ) {
      this.rig.delete();
      this.active = false;
      return;
    }
    const gold = this.mg.config().oilRigGold(this.rig.level(), owner);
    owner.addGold(gold, this.rig.tile());
    this.mg.stats().goldWork(owner, gold);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return OilRigExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      rig: w.unit(this.rig),
      ticksUntilCycle: this.ticksUntilCycle,
    });
  }

  restoreSnapshot(s: OilRigState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.rig = r.unit(s.rig);
    this.ticksUntilCycle = s.ticksUntilCycle;
  }
}

const OilRigStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  rig: zRef(),
  ticksUntilCycle: zInt(),
});
type OilRigState = z.infer<typeof OilRigStateSchema>;

export const OilRigExecutionSnapshot = execSnapshotType({
  name: "OilRig",
  version: 1,
  schema: OilRigStateSchema,
  cls: () => OilRigExecution,
});
