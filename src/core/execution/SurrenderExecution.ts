import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";
import { GameUpdateType } from "../game/GameUpdates";

export class SurrenderExecution implements Execution {
  private active = true;
  private recipient: Player | null = null;
  private mg: Game | null = null;
  private requestSent = false;

  constructor(
    private readonly requestor: Player,
    private readonly recipientID: PlayerID,
    private readonly goldRatio?: number,
    private readonly troopRatio?: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, _ticks: number): void {
    if (!mg.config().vassalsEnabled()) {
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `SurrenderExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.mg = mg;
    this.recipient = mg.player(this.recipientID);
  }

  tick(_ticks: number): void {
    if (this.mg === null || this.recipient === null) {
      throw new Error("SurrenderExecution not initialized");
    }

    if (this.requestor === this.recipient) {
      this.active = false;
      return;
    }
    // Already serving someone else
    if (this.requestor.overlord()) {
      this.active = false;
      return;
    }
    if (!this.recipient.isAlive()) {
      this.active = false;
      return;
    }
    if (this.requestor.isVassalOf(this.recipient)) {
      this.active = false;
      return;
    }

    // Await recipient confirmation for humans: send request once then stop
    if (this.recipient.type() === PlayerType.Human && !this.requestSent) {
      this.mg.addUpdate({
        type: GameUpdateType.VassalOfferRequest,
        requestorID: this.requestor.smallID(),
        recipientID: this.recipient.smallID(),
      });
      this.requestSent = true;
      this.active = false;
      return;
    }

    this.requestor.surrenderTo(this.recipient, this.goldRatio, this.troopRatio);

    this.requestor.updateRelation(this.recipient, 100);
    this.recipient.updateRelation(this.requestor, 60);

    this.mg.displayMessage(
      `${this.requestor.displayName()} surrendered and became a vassal of ${this.recipient.displayName()}`,
      MessageType.VASSALAGE_FORMED,
      this.requestor.id(),
      undefined,
      { target: this.recipient.displayName() },
    );
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
