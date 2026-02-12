import {
  AllianceRequest,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  UnitType,
} from "../../game/Game";

export function cancelNukesBetweenAlliedPlayers(
  game: Game,
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

      const targetOwner = game.owner(targetTile);
      if (!targetOwner.isPlayer()) continue;

      const other = launcher === p1 ? p2 : p1;
      if (targetOwner !== other) continue;

      unit.delete(false);
      neutralized.set(launcher, (neutralized.get(launcher) ?? 0) + 1);
    }
  }

  for (const [launcher, count] of neutralized) {
    const other = launcher === p1 ? p2 : p1;

    game.displayMessage(
      "events_display.alliance_nukes_destroyed_outgoing",
      MessageType.ALLIANCE_ACCEPTED,
      launcher.id(),
      undefined,
      { name: other.displayName(), count },
    );

    game.displayMessage(
      "events_display.alliance_nukes_destroyed_incoming",
      MessageType.ALLIANCE_ACCEPTED,
      other.id(),
      undefined,
      { name: launcher.displayName(), count },
    );
  }
}

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
}
