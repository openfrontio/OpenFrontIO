import { Game, MutableAlliance, Player, Tick } from "./Game";

export class AllianceImpl implements MutableAlliance {
  private extensionRequestedRequestor_: boolean = false;
  private extensionRequestedRecipient_: boolean = false;
  private readonly _id: number;
  private createdAtTick_: Tick;

  constructor(
    private readonly mg: Game,
    readonly requestor_: Player,
    readonly recipient_: Player,
    createdAtTick: Tick,
    id: number,
  ) {
    this.createdAtTick_ = createdAtTick;
    this._id = id;
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
    return this.createdAtTick_;
  }

  expire(): void {
    this.mg.expireAlliance(this);
  }

  requestExtension(player: Player): void {
    if (this.requestor_ === player) {
      this.extensionRequestedRequestor_ = true;
    } else if (this.recipient_ === player) {
      this.extensionRequestedRecipient_ = true;
    }
  }

  extensionRequestedBy(player: Player): boolean {
    if (this.requestor_ === player) {
      return this.extensionRequestedRequestor_;
    } else if (this.recipient_ === player) {
      return this.extensionRequestedRecipient_;
    }
    return false;
  }

  wantsExtension(): boolean {
    return (
      this.extensionRequestedRequestor_ && this.extensionRequestedRecipient_
    );
  }

  clearExtensionRequests(): void {
    this.extensionRequestedRequestor_ = false;
    this.extensionRequestedRecipient_ = false;
  }

  public id(): number {
    return this._id;
  }

  extendDuration(currentTick: Tick): void {
    this.createdAtTick_ = currentTick;
    this.clearExtensionRequests();
  }

  public otherPlayer(player: Player): Player {
    if (this.requestor_ === player) return this.recipient_;
    if (this.recipient_ === player) return this.requestor_;
    throw new Error("[AllianceImpl] Player is not part of this alliance");
  }
}
