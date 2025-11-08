import { Execution, Game, Player, PlayerID } from "../../game/Game";

export class RevokeAllianceRequestExecution implements Execution {
  constructor(
    private requestor: Player,
    private recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `RevokeAllianceRequestExecution recipient ${this.recipientID} not found`,
      );
      return;
    }

    const recipient = mg.player(this.recipientID);
    const request = this.requestor
      .outgoingAllianceRequests()
      .find((ar) => ar.recipient() === recipient);

    if (request && request.status() === "pending") {
      request.revoke();
    }
  }

  tick(ticks: number): void {
    // No-op
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
