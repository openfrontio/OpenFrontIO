import { Game, MutableAlliance, Player, Tick } from "./Game";

export class AllianceImpl implements MutableAlliance {
  private extensionRequestedRequestor_: boolean = false;
  private extensionRequestedRecipient_: boolean = false;

  private expiresAt_: Tick;

  constructor(
    private readonly mg: Game,
    readonly requestor_: Player,
    readonly recipient_: Player,
    private readonly createdAt_: Tick,
    private readonly id_: number,
  ) {
    this.expiresAt_ = createdAt_ + mg.config().allianceDuration();
  }

  other(player: Player): Player {
    if (this.requestor_ === player) {
      return this.recipient_;
    }
    return this.requestor_;
  }

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  createdAt(): Tick {
    return this.createdAt_;
  }

  expire(): void {
    this.mg.expireAlliance(this);
  }

  addExtensionRequest(player: Player): void {
    if (this.requestor_ === player) {
      this.extensionRequestedRequestor_ = true;
    } else if (this.recipient_ === player) {
      this.extensionRequestedRecipient_ = true;
    }
  }

  canExtend(): boolean {
    return (
      this.extensionRequestedRequestor_ && this.extensionRequestedRecipient_
    );
  }

  public id(): number {
    return this.id_;
  }

  extend(): void {
    this.extensionRequestedRequestor_ = false;
    this.extensionRequestedRecipient_ = false;
    this.expiresAt_ = this.mg.ticks() + this.mg.config().allianceDuration();
  }

  expiresAt(): Tick {
    return this.expiresAt_;
  }
}
