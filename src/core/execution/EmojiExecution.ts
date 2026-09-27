import { z } from "zod";
import { AllPlayers, Execution, Game, Player, PlayerID } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zNum, zPlayerRef, zRandom } from "../snapshot/SnapshotType";
import { flattenedEmojiTable } from "../Util";
import { respondToEmoji } from "./nation/NationEmojiBehavior";

export class EmojiExecution implements Execution {
  private recipient: Player | typeof AllPlayers;

  private mg: Game;
  private random: PseudoRandom;

  private active = true;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID | typeof AllPlayers,
    private emoji: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (this.recipientID !== AllPlayers && !mg.hasPlayer(this.recipientID)) {
      console.warn(`EmojiExecution: recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.recipient =
      this.recipientID === AllPlayers
        ? AllPlayers
        : mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    const emojiString = flattenedEmojiTable[this.emoji];
    if (emojiString === undefined) {
      console.warn(
        `cannot send emoji ${this.emoji} from ${this.requestor} to ${this.recipient}`,
      );
    } else if (this.requestor.canSendEmoji(this.recipient)) {
      this.requestor.sendEmoji(this.recipient, emojiString);
      respondToEmoji(
        this.mg,
        this.random,
        this.requestor,
        this.recipient,
        emojiString,
      );
    } else {
      console.warn(
        `cannot send emoji from ${this.requestor} to ${this.recipient}`,
      );
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
    return EmojiExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      recipient:
        this.recipient === undefined
          ? null
          : this.recipient === AllPlayers
            ? AllPlayers
            : w.player(this.recipient),
      random: this.random === undefined ? null : w.random(this.random),
      requestor: w.player(this.requestor),
      recipientID: this.recipientID,
      emoji: this.emoji,
    });
  }

  restoreSnapshot(s: EmojiState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.recipient !== null) {
      this.recipient =
        s.recipient === AllPlayers ? AllPlayers : r.player(s.recipient);
    }
    if (s.random !== null) this.random = r.random(s.random);
    this.requestor = r.player(s.requestor);
    this.recipientID = s.recipientID;
    this.emoji = s.emoji;
  }
}

const EmojiStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  recipient: z.union([z.literal(AllPlayers), zPlayerRef()]).nullable(),
  random: zRandom().nullable(),
  requestor: zPlayerRef(),
  recipientID: z.string(),
  emoji: zNum(),
});
type EmojiState = z.infer<typeof EmojiStateSchema>;

export const EmojiExecutionSnapshot = execSnapshotType({
  name: "Emoji",
  version: 1,
  schema: EmojiStateSchema,
  cls: () => EmojiExecution,
});
