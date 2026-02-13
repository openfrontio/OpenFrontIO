import {
  Game,
  MessageType,
  MutableAlliance,
  Player,
  Tick,
  UnitType,
} from "./Game";

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

  onCreate(): void {
    // Update relations
    this.requestor_.updateRelation(this.recipient_, 100);
    this.recipient_.updateRelation(this.requestor_, 100);

    // Automatically remove embargoes only if they were automatically created
    if (this.requestor_.hasEmbargoAgainst(this.recipient_))
      this.requestor_.endTemporaryEmbargo(this.recipient_);
    if (this.recipient_.hasEmbargoAgainst(this.requestor_))
      this.recipient_.endTemporaryEmbargo(this.requestor_);

    // Cancel incoming nukes between players
    this.cancelNukesBetweenAlliedPlayers();
  }

  cancelNukesBetweenAlliedPlayers(): void {
    const neutralized = new Map<Player, number>();

    const players = [this.requestor_, this.recipient_];

    for (const launcher of players) {
      for (const unit of launcher.units(
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      )) {
        if (!unit.isActive() || unit.reachedTarget()) continue;

        const targetTile = unit.targetTile();
        if (!targetTile) continue;

        const targetOwner = this.mg.owner(targetTile);
        if (!targetOwner.isPlayer()) continue;

        const other =
          launcher === this.requestor_ ? this.recipient_ : this.requestor_;
        if (targetOwner !== other) continue;

        unit.delete(false);
        neutralized.set(launcher, (neutralized.get(launcher) ?? 0) + 1);
      }
    }

    for (const [launcher, count] of neutralized) {
      const other =
        launcher === this.requestor_ ? this.recipient_ : this.requestor_;

      this.mg.displayMessage(
        "events_display.alliance_nukes_destroyed_outgoing",
        MessageType.ALLIANCE_ACCEPTED,
        launcher.id(),
        undefined,
        { name: other.displayName(), count },
      );

      this.mg.displayMessage(
        "events_display.alliance_nukes_destroyed_incoming",
        MessageType.ALLIANCE_ACCEPTED,
        other.id(),
        undefined,
        { name: launcher.displayName(), count },
      );
    }
  }
}
