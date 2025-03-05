import { consolex } from "../Consolex";
import {
  AllPlayers,
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";

export class EmojiExecution implements Execution {
  private requestor: Player;
  private recipient: Player | typeof AllPlayers;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID | typeof AllPlayers,
    private emoji: string,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.senderID)) {
      console.warn(`EmojiExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }
    if (this.recipientID != AllPlayers && !mg.hasPlayer(this.recipientID)) {
      console.warn(`EmojiExecution: recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.requestor = mg.player(this.senderID);
    this.recipient =
      this.recipientID == AllPlayers ? AllPlayers : mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.requestor.canSendEmoji(this.recipient)) {
      this.requestor.sendEmoji(this.recipient, this.emoji);
      if (
        this.emoji == "🖕" &&
        this.recipient != AllPlayers &&
        this.recipient.type() == PlayerType.FakeHuman
      ) {
        this.recipient.updateRelation(this.requestor, -100);
      }
    } else {
      consolex.warn(
        `cannot send emoji from ${this.requestor} to ${this.recipient}`,
      );
    }
    this.active = false;
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
