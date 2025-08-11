import { Execution, Game, Player, PlayerID } from "../game/Game";

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
    const message = this.getMessageFromKey(this.quickChatKey);

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

    this.mg.stats().actionSendQuickChat(this.sender, this.recipient);

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
}
