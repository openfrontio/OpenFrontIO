import { consolex } from "../Consolex";
import {
  AllPlayers,
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerType,
  UnitType,
} from "../game/Game";

export class ChatExecution implements Execution {
  private requestor: Player;
  private recipient: Player | typeof AllPlayers;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID | typeof AllPlayers,
    private message: string,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.senderID)) {
      console.warn(`ChatExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }
    if (this.recipientID != AllPlayers && !mg.hasPlayer(this.recipientID)) {
      console.warn(`ChatExecution: recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.requestor = mg.player(this.senderID);
    this.recipient =
      this.recipientID == AllPlayers ? AllPlayers : mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.requestor.canSendChat(this.recipient)) {
      this.requestor.sendChat(this.recipient, this.message);
      if (
        this.message == "long live the king" &&
        this.recipient != AllPlayers &&
        this.recipient.type() == PlayerType.FakeHuman
      ) {
        this.recipient.updateRelation(this.requestor, -100);
      }
    } else {
      consolex.warn(
        `cannot send message from ${this.requestor} to ${this.recipient}`,
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
