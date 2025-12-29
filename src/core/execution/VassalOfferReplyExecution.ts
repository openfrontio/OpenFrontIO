import { Execution, Game, MessageType, Player, PlayerID } from "../game/Game";

export class VassalOfferReplyExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private requestor: Player | null = null;
  private recipient: Player | null = null;

  constructor(
    private readonly requestorID: PlayerID,
    private readonly recipientID: PlayerID,
    private readonly accept: boolean,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game): void {
    if (!mg.config().vassalsEnabled()) {
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.requestorID) || !mg.hasPlayer(this.recipientID)) {
      this.active = false;
      return;
    }
    this.mg = mg;
    this.requestor = mg.player(this.requestorID);
    this.recipient = mg.player(this.recipientID);
  }

  tick(): void {
    if (!this.mg || !this.requestor || !this.recipient) {
      throw new Error("VassalOfferReplyExecution not initialized");
    }
    if (!this.accept) {
      this.mg.displayMessage(
        `${this.recipient.displayName()} rejected vassalage from ${this.requestor.displayName()}`,
        MessageType.VASSAL_REJECTED,
        this.recipient.id(),
      );
      this.active = false;
      return;
    }
    // Accept
    const v = this.mg.vassalize(this.recipient, this.requestor);
    if (v !== null) {
      const msg = `${this.recipient.displayName()} accepted vassalage to ${this.requestor.displayName()}`;
      this.mg.displayMessage(msg, MessageType.VASSAL_ACCEPTED, this.recipient.id());
      this.mg.displayMessage(msg, MessageType.VASSAL_ACCEPTED, this.requestor.id());
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
