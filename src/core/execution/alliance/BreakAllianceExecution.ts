import { z } from "zod";
import { Execution, Game, Player, PlayerID } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { zPlayerRef } from "../../snapshot/SnapshotType";

export class BreakAllianceExecution implements Execution {
  private active = true;
  private recipient: Player | null = null;
  private mg: Game | null = null;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `BreakAllianceExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.recipient = mg.player(this.recipientID);
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (
      this.mg === null ||
      this.requestor === null ||
      this.recipient === null
    ) {
      throw new Error("Not initialized");
    }
    const alliance = this.requestor.allianceWith(this.recipient);
    if (alliance === null) {
      console.warn("cant break alliance, not allied");
    } else {
      this.requestor.breakAlliance(alliance);
      this.recipient.updateRelation(this.requestor, -100);

      const neighbors = this.requestor
        .nearby()
        .filter(
          (n): n is Player => n.isPlayer() && !n.isOnSameTeam(this.recipient!),
        );

      for (const neighbor of neighbors) {
        neighbor.updateRelation(this.requestor, -40);
      }
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
    return BreakAllianceExecutionSnapshot.write({
      active: this.active,
      recipient: w.playerOrNull(this.recipient),
      initialized: this.mg !== null,
      requestor: w.player(this.requestor),
      recipientID: this.recipientID,
    });
  }

  restoreSnapshot(s: BreakAllianceState, r: SnapshotReader): void {
    this.active = s.active;
    this.recipient = r.playerOrNull(s.recipient);
    this.mg = s.initialized ? r.game : null;
    this.requestor = r.player(s.requestor);
    this.recipientID = s.recipientID;
  }
}

const BreakAllianceStateSchema = z.object({
  active: z.boolean(),
  recipient: zPlayerRef().nullable(),
  initialized: z.boolean(),
  requestor: zPlayerRef(),
  recipientID: z.string(),
});
type BreakAllianceState = z.infer<typeof BreakAllianceStateSchema>;

export const BreakAllianceExecutionSnapshot = execSnapshotType({
  name: "BreakAlliance",
  version: 1,
  schema: BreakAllianceStateSchema,
  cls: () => BreakAllianceExecution,
});
