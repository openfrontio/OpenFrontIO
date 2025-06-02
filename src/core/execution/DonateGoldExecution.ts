import { consolex } from "../Consolex";
import { Execution, Game, Gold, Player, PlayerID } from "../game/Game";

export class DonateGoldExecution implements Execution {
  private sender: Player;
  private recipient: Player;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID,
    private gold: Gold | null,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.senderID)) {
      console.warn(`DonateExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(`DonateExecution recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.sender = mg.player(this.senderID);
    this.recipient = mg.player(this.recipientID);
    if (this.gold === null) {
      this.gold = this.sender.gold() / 3n;
    }
  }

  tick(ticks: number): void {
    if (this.gold === null) throw new Error("not initialized");
    if (
      this.sender.canDonate(this.recipient) &&
      this.sender.donateGold(this.recipient, this.gold)
    ) {
      this.recipient.updateRelation(this.sender, 50);
    } else {
      consolex.warn(
        `cannot send gold from ${this.sender.name()} to ${this.recipient.name()}`,
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
}
