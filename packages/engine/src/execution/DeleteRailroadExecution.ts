import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Execution, Game, Player } from "@openfront/engine/game/Game";
import { execSnapshotType } from "@openfront/engine/snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "@openfront/engine/snapshot/SnapshotContext";
import { z } from "zod";

export class DeleteRailroadExecution implements Execution {
  private active = true;
  constructor(
    private player: Player,
    private railroadId: number,
    private tile: number,
  ) {}
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  init(game: Game): void {
    if (!this.active) return;
    game.railNetwork().removeRailroad(this.player, this.railroadId, this.tile);
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return DeleteRailroadExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      railroadId: this.railroadId,
      tile: this.tile,
    });
  }
  restoreSnapshot(s: DeleteRailroadState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.railroadId = s.railroadId;
    this.tile = s.tile;
  }
}
const schema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  railroadId: zInt(),
  tile: zInt(),
});
type DeleteRailroadState = z.infer<typeof schema>;
export const DeleteRailroadExecutionSnapshot = execSnapshotType({
  name: "DeleteRailroad",
  version: 1,
  schema,
  cls: () => DeleteRailroadExecution,
});
