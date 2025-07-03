import { Execution, Game, Player, PlayerID } from "../game/Game";

export class DonateTroopsExecution implements Execution {
  private recipient: Player;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private troops: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(`DonateExecution recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    if (this.troops === null) {
      this.troops = mg.config().defaultDonationAmount(this.sender);
    }
    const maxDonation =
      mg.config().maxPopulation(this.recipient) - this.recipient.population();
    this.troops = Math.min(this.troops, maxDonation);
  }

  tick(ticks: number): void {
    if (this.troops === null) throw new Error("not initialized");
    if (
      this.sender.canDonate(this.recipient) &&
      this.sender.donateTroops(this.recipient, this.troops)
    ) {
      this.recipient.updateRelation(this.sender, 50);
    } else {
      console.warn(
        `cannot send troops from ${this.sender} to ${this.recipient}`,
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
