import { Execution, Game, Gold, Player, PlayerID } from "../game/Game";

export class DonateGoldExecution implements Execution {
  private recipient: Player;

  private active = true;

  private mg: Game;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private gold: Gold | null,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(`DonateExecution recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.gold ??= this.sender.gold() / 3n;

    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.gold === null) throw new Error("not initialized");
    if (
      this.sender.canDonateGold(this.recipient) &&
      this.sender.donateGold(this.recipient, this.gold)
    ) {
      // stats for donated gold
      this.mg.stats().actionSendGold(this.sender, this.recipient, this.gold);
      this.recipient.updateRelation(this.sender, 50);
    } else {
      console.warn(
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
