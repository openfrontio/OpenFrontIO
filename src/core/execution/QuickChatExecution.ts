import { consolex } from "../Consolex";
import { Execution, Game, Player, PlayerID } from "../game/Game";

export class QuickChatExecution implements Execution {
  private sender: Player;
  private recipient: Player;
  private mg: Game;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID,
    private quickChatKey: string,
    private target: PlayerID | undefined,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.senderID)) {
      consolex.warn(`QuickChatExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      consolex.warn(
        `QuickChatExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.sender = mg.player(this.senderID);
    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    const message = this.getMessageFromKey(this.quickChatKey);

    this.mg.displayChat(
      message[1],
      message[0],
      this.target,
      this.recipient.id(),
      true,
      this.sender.name(),
    );

    this.mg.displayChat(
      message[1],
      message[0],
      this.target,
      this.sender.id(),
      false,
      this.recipient.name(),
    );

    consolex.log(
      `[QuickChat] ${this.sender.name} → ${this.recipient.name}: ${message}`,
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
}
