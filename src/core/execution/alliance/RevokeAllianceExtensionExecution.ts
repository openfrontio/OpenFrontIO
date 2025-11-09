import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";

/**
 * Execution for revoking a pending alliance renewal/extension request.
 * Only sends a notification to the other player if an extension request was actually revoked.
 */
export class RevokeAllianceExtensionExecution implements Execution {
  constructor(
    private readonly from: Player,
    private readonly toID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    // Validate recipient exists
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[RevokeAllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }

    const to = mg.player(this.toID);

    // Validate both players are alive
    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[RevokeAllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    // Validate alliance exists
    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[RevokeAllianceExtensionExecution] No alliance exists between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Check if this player had an active extension request before removing it
    const hadRequestedExtension = alliance.hasRequestedExtension(this.from);

    // Remove this player's extension request
    alliance.removeExtensionRequest(this.from);

    // Notify the other player only if an extension request was actually revoked
    if (hadRequestedExtension) {
      mg.displayMessage(
        "events_display.alliance_extension_revoked",
        MessageType.RENEW_ALLIANCE,
        to.id(),
        undefined,
        { name: this.from.displayName() },
      );
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
