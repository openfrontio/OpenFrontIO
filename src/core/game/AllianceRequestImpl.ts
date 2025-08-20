import { AllianceRequest, Player, Tick } from "./Game";
import { AllianceRequestUpdate, GameUpdateType } from "./GameUpdates";
import { GameImpl } from "./GameImpl";

export class AllianceRequestImpl implements AllianceRequest {
  constructor(
    private readonly requestor_: Player,
    private readonly recipient_: Player,
    private readonly tickCreated: number,
    private readonly game: GameImpl,
  ) {}

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
    this.game.acceptAllianceRequest(this);
  }
  reject(): void {
    this.game.rejectAllianceRequest(this);
  }

  toUpdate(): AllianceRequestUpdate {
    return {
      createdAt: this.tickCreated,
      recipientID: this.recipient_.smallID(),
      requestorID: this.requestor_.smallID(),
      type: GameUpdateType.AllianceRequest,
    };
  }
}
