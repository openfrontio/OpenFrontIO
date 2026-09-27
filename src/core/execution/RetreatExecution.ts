import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zPlayerRef } from "../snapshot/SnapshotType";

const cancelDelay = 20;

export class RetreatExecution implements Execution {
  private active = true;
  private retreatOrdered = false;
  private startTick: number;
  private mg: Game;
  constructor(
    private player: Player,
    private attackID: string,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.startTick = mg.ticks();
  }

  tick(ticks: number): void {
    if (!this.retreatOrdered) {
      this.player.orderRetreat(this.attackID);
      this.retreatOrdered = true;
    }

    if (this.mg.ticks() >= this.startTick + cancelDelay) {
      this.player.executeRetreat(this.attackID);
      this.active = false;
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return RetreatExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      retreatOrdered: this.retreatOrdered,
      startTick: this.startTick ?? null,
      player: w.player(this.player),
      attackID: this.attackID,
    });
  }

  restoreSnapshot(s: RetreatState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.retreatOrdered = s.retreatOrdered;
    if (s.startTick !== null) this.startTick = s.startTick;
    this.player = r.player(s.player);
    this.attackID = s.attackID;
  }
}

const RetreatStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  retreatOrdered: z.boolean(),
  startTick: zInt().nullable(),
  player: zPlayerRef(),
  attackID: z.string(),
});
type RetreatState = z.infer<typeof RetreatStateSchema>;

export const RetreatExecutionSnapshot = execSnapshotType({
  name: "Retreat",
  version: 1,
  schema: RetreatStateSchema,
  cls: () => RetreatExecution,
});
