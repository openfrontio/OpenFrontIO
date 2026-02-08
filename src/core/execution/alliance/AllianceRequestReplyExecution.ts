import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class AllianceRequestReplyExecution implements Execution {
  private active = true;
  private requestor: Player | null = null;

  constructor(
    private requestorID: PlayerID,
    private recipient: Player,
    private accept: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.requestorID)) {
      console.warn(
        `AllianceRequestReplyExecution requester ${this.requestorID} not found`,
      );
      this.active = false;
      return;
    }
    this.requestor = mg.player(this.requestorID);

    if (this.requestor.isFriendly(this.recipient)) {
      console.warn("already allied");
    } else {
      const request = this.requestor
        .outgoingAllianceRequests()
        .find((ar) => ar.recipient() === this.recipient);
      if (request === undefined) {
        console.warn("no alliance request found");
      } else {
        if (this.accept) {
          request.accept();
          this.requestor.updateRelation(this.recipient, 100);
          this.recipient.updateRelation(this.requestor, 100);
        } else {
          request.reject();
        }
      }
    }
    this.active = false;
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
