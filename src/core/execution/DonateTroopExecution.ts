import { consolex } from "../Consolex";
import { Execution, Game, Player, PlayerID } from "../game/Game";

export class DonateTroopsExecution implements Execution {
  private sender: Player;
  private recipient: Player;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID,
    private troops: number | null,
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
      consolex.warn(
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
