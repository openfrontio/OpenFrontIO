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
 * Runs a finished Uranium Mine: every uraniumMineCycleTicks it adds
 * `level * uraniumPerMineCycle` uranium to whoever owns the mine now (a
 * captured mine produces for its captor).
 */
export class UraniumMineExecution implements Execution {
  private active = true;
  private mg: Game;
  private ticksUntilCycle = 0;

  constructor(private mine: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.ticksUntilCycle = mg.config().uraniumMineCycleTicks();
  }

  tick(ticks: number): void {
    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }
    // An upgrade puts the mine back under construction; it pauses meanwhile.
    if (this.mine.isUnderConstruction()) {
      return;
    }
    if (--this.ticksUntilCycle > 0) {
      return;
    }
    this.ticksUntilCycle = this.mg.config().uraniumMineCycleTicks();
    const amount = this.mine.level() * this.mg.config().uraniumPerMineCycle();
    this.mine.owner().addMinedUranium(amount);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return UraniumMineExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      mine: w.unit(this.mine),
      ticksUntilCycle: this.ticksUntilCycle,
    });
  }

  restoreSnapshot(s: UraniumMineState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.mine = r.unit(s.mine);
    this.ticksUntilCycle = s.ticksUntilCycle;
  }
}

const UraniumMineStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  mine: zRef(),
  ticksUntilCycle: zInt(),
});
type UraniumMineState = z.infer<typeof UraniumMineStateSchema>;

export const UraniumMineExecutionSnapshot = execSnapshotType({
  name: "UraniumMine",
  version: 1,
  schema: UraniumMineStateSchema,
  cls: () => UraniumMineExecution,
});
