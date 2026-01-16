import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  UnitType,
} from "../../game/Game";

export class AllianceRequestReplyExecution implements Execution {
  private active = true;
  private requestor: Player | null = null;

  constructor(
    private requestorID: PlayerID,
    private recipient: Player,
    private accept: boolean,
  ) {}

  private cancelNukesBetweenAlliedPlayers(
    mg: Game,
    p1: Player,
    p2: Player,
  ): void {
    const neutralized = new Map<Player, number>();

    const players = [p1, p2];

    for (const launcher of players) {
      for (const unit of launcher.units(
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
      )) {
        if (!unit.isActive() || unit.reachedTarget()) continue;

        const targetTile = unit.targetTile();
        if (!targetTile) continue;

        const targetOwner = mg.owner(targetTile);
        if (!targetOwner.isPlayer()) continue;

        const other = launcher === p1 ? p2 : p1;
        if (targetOwner !== other) continue;

        unit.delete(false);
        neutralized.set(launcher, (neutralized.get(launcher) ?? 0) + 1);
      }
    }

    for (const [launcher, count] of neutralized) {
      const other = launcher === p1 ? p2 : p1;

      mg.displayMessage(
        "events_display.alliance_nukes_destroyed_outgoing",
        MessageType.ALLIANCE_ACCEPTED,
        launcher.id(),
        undefined,
        { name: other.displayName(), count },
      );

      mg.displayMessage(
        "events_display.alliance_nukes_destroyed_incoming",
        MessageType.ALLIANCE_ACCEPTED,
        other.id(),
        undefined,
        { name: launcher.displayName(), count },
      );
    }
  }

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.requestorID)) {
      console.warn(
        `AllianceRequestReplyExecution requester ${this.requestorID} not found`,
      );
      this.active = false;
      return;
    }
    this.requestor = mg.player(this.requestorID);

    if (this.requestor.isFriendly(this.recipient)) {
      console.warn("already allied");
    } else {
      const request = this.requestor
        .outgoingAllianceRequests()
        .find((ar) => ar.recipient() === this.recipient);
      if (request === undefined) {
        console.warn("no alliance request found");
      } else {
        if (this.accept) {
          request.accept();
          this.requestor.updateRelation(this.recipient, 100);
          this.recipient.updateRelation(this.requestor, 100);

          this.cancelNukesBetweenAlliedPlayers(
            mg,
            this.requestor,
            this.recipient,
          );
        } else {
          request.reject();
        }
      }
    }
    this.active = false;
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
