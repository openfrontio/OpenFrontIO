import { z } from "zod";
import { Execution, Game, Player, PlayerType } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

export class EmbargoAllExecution implements Execution {
  constructor(
    private player: Player,
    private action: "start" | "stop",
  ) {}

  init(mg: Game, _: number): void {
    if (!this.player.canEmbargoAll()) {
      return;
    }
    const me = this.player;
    for (const p of mg.players()) {
      if (p.id() === me.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (me.isOnSameTeam(p)) continue;

      if (this.action === "start") {
        if (!me.hasEmbargoAgainst(p)) me.addEmbargo(p, false);
      } else {
        if (me.hasEmbargoAgainst(p)) me.stopEmbargo(p);
      }
    }

    this.player.recordEmbargoAll();
  }

  tick(_: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return EmbargoAllExecutionSnapshot.write({
      player: w.player(this.player),
      action: this.action,
    });
  }

  restoreSnapshot(s: EmbargoAllState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.action = s.action;
  }
}

const EmbargoAllStateSchema = z.object({
  player: zPlayerRef(),
  action: z.enum(["start", "stop"]),
});
type EmbargoAllState = z.infer<typeof EmbargoAllStateSchema>;

export const EmbargoAllExecutionSnapshot = execSnapshotType({
  name: "EmbargoAll",
  version: 1,
  schema: EmbargoAllStateSchema,
  cls: () => EmbargoAllExecution,
});
