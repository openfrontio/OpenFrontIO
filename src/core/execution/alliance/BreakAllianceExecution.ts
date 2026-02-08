import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class BreakAllianceExecution implements Execution {
  private active = true;
  private recipient: Player | null = null;
  private mg: Game | null = null;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `BreakAllianceExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.recipient = mg.player(this.recipientID);
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (
      this.mg === null ||
      this.requestor === null ||
      this.recipient === null
    ) {
      throw new Error("Not initialized");
    }
    const alliance = this.requestor.allianceWith(this.recipient);
    if (alliance === null) {
      this.active = false;
      return;
    }
    this.requestor.breakAlliance(alliance);
    this.recipient.updateRelation(this.requestor, -100);

    const neighbors = this.requestor
      .neighbors()
      .filter(
        (n): n is Player => n.isPlayer() && !n.isOnSameTeam(this.recipient!),
      );

    for (const neighbor of neighbors) {
      neighbor.updateRelation(this.requestor, -40);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
