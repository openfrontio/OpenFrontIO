import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class AllianceRequestExecution implements Execution {
  private active = true;
  private recipient: Player | null = null;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `AllianceRequestExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.recipient === null) {
      throw new Error("Not initialized");
    }
    if (this.requestor.isFriendly(this.recipient)) {
      console.warn("already allied");
    } else if (!this.requestor.canSendAllianceRequest(this.recipient)) {
      console.warn("recent or pending alliance request");
    } else {
      this.requestor.createAllianceRequest(this.recipient);
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
