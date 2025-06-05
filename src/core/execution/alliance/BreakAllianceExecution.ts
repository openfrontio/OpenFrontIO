import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class BreakAllianceExecution implements Execution {
  private active = true;
  private requestor: Player | null = null;
  private recipient: Player | null = null;
  private mg: Game | null = null;

  constructor(
    private requestorID: PlayerID,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.requestorID)) {
      console.warn(
        `BreakAllianceExecution requester ${this.requestorID} not found`,
      );
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `BreakAllianceExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.requestor = mg.player(this.requestorID);
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
      console.warn("cant break alliance, not allied");
    } else {
      this.requestor.breakAlliance(alliance);
      this.recipient.updateRelation(this.requestor, -200);
      for (const player of this.mg.players()) {
        if (player !== this.requestor) {
          player.updateRelation(this.requestor, -40);
        }
      }
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
