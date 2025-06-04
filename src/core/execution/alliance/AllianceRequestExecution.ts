import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class AllianceRequestExecution implements Execution {
  private active = true;
  private requestor: Player | null = null;
  private recipient: Player | null = null;

  constructor(
    private requestorID: PlayerID,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.requestorID)) {
      console.warn(
        `AllianceRequestExecution requester ${this.requestorID} not found`,
      );
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `AllianceRequestExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.requestor = mg.player(this.requestorID);
    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.requestor === null || this.recipient === null) {
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
