import { Game, MutableAlliance, Player, Tick } from "./Game";

export class AllianceImpl implements MutableAlliance {
  private requestedExtension_ = false;
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
    return this.requestor_ === player ? this.recipient_ : this.requestor_;
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

  wantsExtension(): boolean {
    return this.requestedExtension_;
  }

  setWantsExtension(v: boolean): void {
    this.requestedExtension_ = v;
  }

  resetExtensionRequest(): void {
    this.requestedExtension_ = false;
  }

  public id(): number {
    return this._id;
  }

  extendDuration(currentTick: Tick): void {
    this.createdAtTick_ = currentTick;
    this.resetExtensionRequest();
  }
}
