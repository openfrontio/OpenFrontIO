import { z } from "zod";
import { Execution, Game, Player, PlayerID } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

export class EmbargoExecution implements Execution {
  private active = true;

  private target: Player;

  constructor(
    private player: Player,
    private targetID: PlayerID,
    private action: "start" | "stop",
  ) {}

  init(mg: Game, _: number): void {
    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`EmbargoExecution recipient ${this.targetID} not found`);
      this.active = false;
      return;
    }
    this.target = mg.player(this.targetID);
  }

  tick(_: number): void {
    if (this.action === "start") this.player.addEmbargo(this.target, false);
    else this.player.stopEmbargo(this.target);

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return EmbargoExecutionSnapshot.write({
      active: this.active,
      target: this.target === undefined ? null : w.player(this.target),
      player: w.player(this.player),
      targetID: this.targetID,
      action: this.action,
    });
  }

  restoreSnapshot(s: EmbargoState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.target !== null) this.target = r.player(s.target);
    this.player = r.player(s.player);
    this.targetID = s.targetID;
    this.action = s.action;
  }
}

const EmbargoStateSchema = z.object({
  active: z.boolean(),
  target: zPlayerRef().nullable(),
  player: zPlayerRef(),
  targetID: z.string(),
  action: z.enum(["start", "stop"]),
});
type EmbargoState = z.infer<typeof EmbargoStateSchema>;

export const EmbargoExecutionSnapshot = execSnapshotType({
  name: "Embargo",
  version: 1,
  schema: EmbargoStateSchema,
  cls: () => EmbargoExecution,
});
