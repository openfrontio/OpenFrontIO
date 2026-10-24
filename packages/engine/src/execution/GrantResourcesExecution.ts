import { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { toInt } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Grants gold and/or troops to a player without a donor. Only the admin bot
 * sends it (see authorizeIntent), so unlike the donate executions it has no
 * sender player: the turn-queue path stamps ADMIN_BOT_CLIENT_ID, which is not
 * a real player, and ExecutionManager builds this execution before the
 * sender lookup. Deterministic: fixed amounts, applied in one tick.
 */
export class GrantResourcesExecution implements Execution {
  private target: Player;
  private gold: bigint | null;

  private mg: Game;

  private active = true;

  constructor(
    private targetID: PlayerID,
    goldNum: number | null,
    private troops: number | null,
  ) {
    this.gold = goldNum !== null ? toInt(goldNum) : null;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;

    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`GrantResourcesExecution target ${this.targetID} not found`);
      this.active = false;
      return;
    }

    this.target = mg.player(this.targetID);
  }

  tick(_ticks: number): void {
    if (this.gold !== null) {
      this.target.addGold(this.gold);
    }
    if (this.troops !== null) {
      this.target.addTroops(this.troops);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return GrantResourcesExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      target: this.target === undefined ? null : w.player(this.target),
      gold: this.gold,
      troops: this.troops,
      targetID: this.targetID,
    });
  }

  restoreSnapshot(s: GrantResourcesState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.target !== null) this.target = r.player(s.target);
    this.gold = s.gold;
    this.troops = s.troops;
    this.targetID = s.targetID;
  }
}

const GrantResourcesStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  target: zPlayerRef().nullable(),
  gold: z.bigint().nullable(),
  troops: z.number().nullable(),
  targetID: z.string(),
});
type GrantResourcesState = z.infer<typeof GrantResourcesStateSchema>;

export const GrantResourcesExecutionSnapshot = execSnapshotType({
  name: "GrantResources",
  version: 1,
  schema: GrantResourcesStateSchema,
  cls: () => GrantResourcesExecution,
});
