import { Execution, Game, Player, PlayerID } from "../game/Game";

export class QuickChatExecution implements Execution {
  private recipient: Player;
  private mg: Game;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private quickChatKey: string,
    private variables: Record<string, string>,
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
    const message = this.getMessageFromKey(this.quickChatKey, this.variables);

    this.mg.displayChat(
      message[1],
      message[0],
      this.variables,
      this.recipient.id(),
      true,
      this.sender.name(),
    );

    this.mg.displayChat(
      message[1],
      message[0],
      this.variables,
      this.sender.id(),
      false,
      this.recipient.name(),
    );

    console.log(
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

  private getMessageFromKey(
    fullKey: string,
    vars: Record<string, string>,
  ): string[] {
    const translated = fullKey.split(".");
    return translated;
  }
}
