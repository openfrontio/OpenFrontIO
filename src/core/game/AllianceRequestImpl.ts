import { AllianceRequest, Player, Tick } from "./Game";
import { GameImpl } from "./GameImpl";
import { GameUpdate, GameUpdateType } from "./GameUpdates";

export class AllianceRequestImpl implements AllianceRequest {
  private status_: "pending" | "accepted" | "rejected" = "pending";

  constructor(
    private requestor_: Player,
    private recipient_: Player,
    private tickCreated: number,
    private game: GameImpl,
  ) {}

  status(): "pending" | "accepted" | "rejected" {
    return this.status_;
  }

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  createdAt(): Tick {
    return this.tickCreated;
  }

  accept(): void {
    this.status_ = "accepted";
    this.game.acceptAllianceRequest(this);
  }
  reject(): void {
    this.status_ = "rejected";
    this.game.rejectAllianceRequest(this);
  }

  toUpdate(): GameUpdate {
    return {
      type: GameUpdateType.AllianceRequest,
      allianceRequest: {
        requestorId: this.requestor_.smallID(),
        recipientId: this.recipient_.smallID(),
        createdAt: this.tickCreated,
      },
    };
  }
}
