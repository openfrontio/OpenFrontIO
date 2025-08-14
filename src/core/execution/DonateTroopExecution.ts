import { Execution, Game, Player, PlayerID } from "../game/Game";

export class DonateTroopsExecution implements Execution {
  private recipient: Player;

  private active = true;

  private mg: Game;

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
    this.troops ??= mg.config().defaultDonationAmount(this.sender);
    const maxDonation =
      mg.config().maxTroops(this.recipient) - this.recipient.troops();
    this.troops = Math.min(this.troops, maxDonation);

    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.troops === null) throw new Error("not initialized");
    if (
      this.sender.canDonateTroops(this.recipient) &&
      this.sender.donateTroops(this.recipient, this.troops)
    ) {
      // stats for donated troops (uses backend # and not UI)
      this.mg
        .stats()
        .actionSendTroops(this.sender, this.recipient, this.troops);
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
