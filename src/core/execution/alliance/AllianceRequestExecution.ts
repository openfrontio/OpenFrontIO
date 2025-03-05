import { consolex } from "../../Consolex";
import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class AllianceRequestExecution implements Execution {
  private active = true;
  private mg: Game = null;
  private requestor: Player;
  private recipient: Player;

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

    this.mg = mg;
    this.requestor = mg.player(this.requestorID);
    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    if (this.requestor.isAlliedWith(this.recipient)) {
      consolex.warn("already allied");
    } else if (!this.requestor.canSendAllianceRequest(this.recipient)) {
      consolex.warn("recent or pending alliance request");
    } else {
      this.requestor.createAllianceRequest(this.recipient);
    }
    this.active = false;
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
