import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zRef } from "../snapshot/SnapshotType";

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private silo: Unit;

  constructor(silo: Unit) {
    this.silo = silo;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.silo.isUnderConstruction()) {
      return;
    }

    if (!this.silo.isActive()) {
      this.active = false;
      return;
    }

    // frontTime is the time the earliest missile fired.
    const frontTime = this.silo.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().SiloCooldown() - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.silo.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MissileSiloExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      silo: w.unit(this.silo),
    });
  }

  restoreSnapshot(s: MissileSiloState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.silo = r.unit(s.silo);
  }
}

const MissileSiloStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  silo: zRef(),
});
type MissileSiloState = z.infer<typeof MissileSiloStateSchema>;

export const MissileSiloExecutionSnapshot = execSnapshotType({
  name: "MissileSilo",
  version: 1,
  schema: MissileSiloStateSchema,
  cls: () => MissileSiloExecution,
});
