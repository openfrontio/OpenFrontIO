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

  /**
   * Marks that the given player has requested to extend this alliance.
   */
  addExtensionRequest(player: Player): void {
    if (this.requestor_ === player) {
      this.extensionRequestedRequestor_ = true;
    } else if (this.recipient_ === player) {
      this.extensionRequestedRecipient_ = true;
    }
  }

  /**
   * Removes the extension request from the given player.
   * Used when a player revokes their renewal request.
   */
  removeExtensionRequest(player: Player): void {
    if (this.requestor_ === player) {
      this.extensionRequestedRequestor_ = false;
    } else if (this.recipient_ === player) {
      this.extensionRequestedRecipient_ = false;
    }
  }

  /**
   * Checks if the given player has an active extension request.
   */
  hasRequestedExtension(player: Player): boolean {
    if (this.requestor_ === player) {
      return this.extensionRequestedRequestor_;
    } else if (this.recipient_ === player) {
      return this.extensionRequestedRecipient_;
    }
    return false;
  }

  /**
   * Returns true if both players have requested to extend the alliance.
   */
  bothAgreedToExtend(): boolean {
    return (
      this.extensionRequestedRequestor_ && this.extensionRequestedRecipient_
    );
  }

  /**
   * Returns true if exactly one player has requested to extend the alliance.
   * False if neither player has requested (both false) or both have requested (both true).
   */
  onlyOneAgreedToExtend(): boolean {
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
