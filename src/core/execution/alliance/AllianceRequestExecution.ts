import {
  AllianceRequest,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  UnitType,
} from "../../game/Game";

export class AllianceRequestExecution implements Execution {
  private req: AllianceRequest | null = null;
  private active = true;
  private mg: Game;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `AllianceRequestExecution recipient ${this.recipientID} not found`,
      );
      return;
    }

    const recipient = mg.player(this.recipientID);

    if (!this.requestor.canSendAllianceRequest(recipient)) {
      console.warn("cannot send alliance request");
      this.active = false;
    } else {
      const incoming = recipient
        .outgoingAllianceRequests()
        .find((r) => r.recipient() === this.requestor);
      if (incoming) {
        // If the recipient already has pending alliance request,
        // then accept it instead of creating a new one.
        this.active = false;
        incoming.accept();

        // Update player relations
        this.requestor.updateRelation(recipient, 100);
        recipient.updateRelation(this.requestor, 100);

        // Automatically remove embargoes only if they were automatically created
        if (this.requestor.hasEmbargoAgainst(recipient))
          this.requestor.endTemporaryEmbargo(recipient);
        if (recipient.hasEmbargoAgainst(this.requestor))
          recipient.endTemporaryEmbargo(this.requestor);

        // Cancel incoming nukes between players
        this.cancelNukesBetweenAlliedPlayers(recipient);
      } else {
        this.req = this.requestor.createAllianceRequest(recipient);
      }
    }
  }

  tick(ticks: number): void {
    if (
      this.req?.status() === "accepted" ||
      this.req?.status() === "rejected"
    ) {
      this.active = false;
      return;
    }
    if (
      this.mg.ticks() - (this.req?.createdAt() ?? 0) >
      this.mg.config().allianceRequestDuration()
    ) {
      this.req?.reject();
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  cancelNukesBetweenAlliedPlayers(recipient: Player): void {
    const neutralized = new Map<Player, number>();

    const players = [this.requestor, recipient];

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

        const other = launcher === this.requestor ? recipient : this.requestor;
        if (targetOwner !== other) continue;

        unit.delete(false);
        neutralized.set(launcher, (neutralized.get(launcher) ?? 0) + 1);
      }
    }

    for (const [launcher, count] of neutralized) {
      const other = launcher === this.requestor ? recipient : this.requestor;

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
