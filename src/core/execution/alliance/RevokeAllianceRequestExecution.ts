import { Execution, Game, Player, PlayerID } from "../../game/Game";

/**
 * Execution for revoking a pending alliance request.
 * Only pending requests can be revoked; accepted or rejected requests are ignored.
 */
export class RevokeAllianceRequestExecution implements Execution {
  constructor(
    private readonly requestor: Player,
    private readonly recipientID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    // Validate recipient exists
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `[RevokeAllianceRequestExecution] Recipient ${this.recipientID} not found`,
      );
      return;
    }

    const recipient = mg.player(this.recipientID);

    // Find the pending alliance request
    const request = this.requestor
      .outgoingAllianceRequests()
      .find((ar) => ar.recipient() === recipient);

    // Only revoke if request exists and is still pending
    if (request?.status() === "pending") {
      request.revoke();
    }
  }

  tick(ticks: number): void {
    // No-op - revocation happens immediately in init()
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
