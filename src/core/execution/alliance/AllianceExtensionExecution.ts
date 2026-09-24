import { z } from "zod";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { zPlayerRef } from "../../snapshot/SnapshotType";

export class AllianceExtensionExecution implements Execution {
  constructor(
    private from: Player,
    private toID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[AllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }
    const to = mg.player(this.toID);

    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[AllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance to extend between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Check if this is a new request (before adding it)
    const wasOnlyOneAgreed = alliance.onlyOneAgreedToExtend();

    // Mark this player's intent to extend
    alliance.addExtensionRequest(this.from);

    if (alliance.bothAgreedToExtend()) {
      alliance.extend();

      mg.displayMessage(
        "events_display.alliance_renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.from.id(),
        undefined,
        { name: to.displayName() },
        undefined,
        to.id(),
      );
      mg.displayMessage(
        "events_display.alliance_renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.toID,
        undefined,
        { name: this.from.displayName() },
        undefined,
        this.from.id(),
      );
    } else if (alliance.onlyOneAgreedToExtend() && !wasOnlyOneAgreed) {
      // Send message to the other player that someone wants to renew
      // Only send if this is a new request (transition from "none" to "one")
      mg.displayMessage(
        "events_display.wants_to_renew_alliance",
        MessageType.RENEW_ALLIANCE,
        this.toID,
        undefined,
        { name: this.from.displayName() },
        undefined,
        this.from.id(),
      );
    }
  }

  tick(ticks: number): void {
    // No-op
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AllianceExtensionExecutionSnapshot.write({
      from: w.player(this.from),
      toID: this.toID,
    });
  }

  restoreSnapshot(s: AllianceExtensionState, r: SnapshotReader): void {
    this.from = r.player(s.from);
    this.toID = s.toID;
  }
}

const AllianceExtensionStateSchema = z.object({
  from: zPlayerRef(),
  toID: z.string(),
});
type AllianceExtensionState = z.infer<typeof AllianceExtensionStateSchema>;

export const AllianceExtensionExecutionSnapshot = execSnapshotType({
  name: "AllianceExtension",
  version: 1,
  schema: AllianceExtensionStateSchema,
  cls: () => AllianceExtensionExecution,
});
