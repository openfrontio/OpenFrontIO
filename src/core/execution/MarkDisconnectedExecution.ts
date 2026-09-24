import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

export class MarkDisconnectedExecution implements Execution {
  constructor(
    private player: Player,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (this.isDisconnected) {
      const team = this.player.team();
      const teamTiles = team ? mg.teamTilesOwned(team) : 0;
      const totalLand = mg.totalLandTiles();
      this.player.markDisconnected(true, {
        currentTick: ticks,
        teamTiles,
        totalLand,
        wasAlive: this.player.isAlive(),
      });
    } else {
      this.player.markDisconnected(false);
    }
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
    return MarkDisconnectedExecutionSnapshot.write({
      player: w.player(this.player),
      isDisconnected: this.isDisconnected,
    });
  }

  restoreSnapshot(s: MarkDisconnectedState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.isDisconnected = s.isDisconnected;
  }
}

const MarkDisconnectedStateSchema = z.object({
  player: zPlayerRef(),
  isDisconnected: z.boolean(),
});
type MarkDisconnectedState = z.infer<typeof MarkDisconnectedStateSchema>;

export const MarkDisconnectedExecutionSnapshot = execSnapshotType({
  name: "MarkDisconnected",
  version: 1,
  schema: MarkDisconnectedStateSchema,
  cls: () => MarkDisconnectedExecution,
});
