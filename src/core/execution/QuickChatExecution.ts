import { z } from "zod";
import { Execution, Game, Player, PlayerID } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

export class QuickChatExecution implements Execution {
  private recipient: Player;
  private mg: Game;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private quickChatKey: string,
    private target: PlayerID | undefined,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `QuickChatExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (!this.sender.canSendQuickChat(this.recipient)) {
      this.active = false;
      return;
    }

    const message = this.getMessageFromKey(this.quickChatKey);

    this.sender.recordQuickChat(this.recipient);

    this.mg.displayChat(
      message[1],
      message[0],
      this.target,
      this.recipient.id(),
      true,
      this.sender.id(),
    );

    this.mg.displayChat(
      message[1],
      message[0],
      this.target,
      this.sender.id(),
      false,
      this.recipient.id(),
    );

    console.log(
      `[QuickChat] ${this.sender.name} → ${this.recipient.displayName}: ${message}`,
    );

    this.active = false;
  }

  owner(): Player {
    return this.sender;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private getMessageFromKey(fullKey: string): string[] {
    const translated = fullKey.split(".");
    return translated;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return QuickChatExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      recipient: this.recipient === undefined ? null : w.player(this.recipient),
      sender: w.player(this.sender),
      recipientID: this.recipientID,
      quickChatKey: this.quickChatKey,
      target: this.target,
    });
  }

  restoreSnapshot(s: QuickChatState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.recipient !== null) this.recipient = r.player(s.recipient);
    this.sender = r.player(s.sender);
    this.recipientID = s.recipientID;
    this.quickChatKey = s.quickChatKey;
    this.target = s.target;
  }
}

const QuickChatStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  recipient: zPlayerRef().nullable(),
  sender: zPlayerRef(),
  recipientID: z.string(),
  quickChatKey: z.string(),
  target: z.string().optional(),
});
type QuickChatState = z.infer<typeof QuickChatStateSchema>;

export const QuickChatExecutionSnapshot = execSnapshotType({
  name: "QuickChat",
  version: 1,
  schema: QuickChatStateSchema,
  cls: () => QuickChatExecution,
});
