import { Game, MutableAlliance, Player, Tick } from "./Game";

export class AllianceImpl implements MutableAlliance {
  private extensionRequestedRequestor_ = false;
  private extensionRequestedRecipient_ = false;

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

  bothAgreedToExtend(): boolean {
    return (
      this.extensionRequestedRequestor_ && this.extensionRequestedRecipient_
    );
  }

  onlyOneAgreedToExtend(): boolean {
    // Requestor / Recipient of the original alliance request, not of the extension request
    // False if: no expiration or neither requested extension yet (both false), or both agreed to extend (both true)
    // True if: one requested extension, other didn't yet or actively ignored (one true, one false)
    return (
      this.extensionRequestedRequestor_ !== this.extensionRequestedRecipient_
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
