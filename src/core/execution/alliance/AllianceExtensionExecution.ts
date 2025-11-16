import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";

/**
 * Execution for requesting an alliance renewal/extension.
 * If both players agree, the alliance is immediately extended.
 * If only one player requests, a notification is sent to the other player.
 */
export class AllianceExtensionExecution implements Execution {
  constructor(
    private readonly from: Player,
    private readonly toID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    // Validate recipient exists
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[AllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }

    const to = mg.player(this.toID);

    // Validate both players are alive
    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[AllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    // Validate alliance exists
    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance exists between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Check extension state before adding this player's request
    const wasOnlyOneAgreed = alliance.onlyOneAgreedToExtend();

    // Add this player's extension request
    alliance.addExtensionRequest(this.from);

    // If both players now agree, extend the alliance immediately
    if (alliance.bothAgreedToExtend()) {
      alliance.extend();

      // Notify both players of the renewal
      mg.displayMessage(
        "events_display.alliance_renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.from.id(),
        undefined,
        { name: to.displayName() },
      );
      mg.displayMessage(
        "events_display.alliance_renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.toID,
        undefined,
        { name: this.from.displayName() },
      );
    } else if (alliance.onlyOneAgreedToExtend() && !wasOnlyOneAgreed) {
      // Only one player has requested extension, and this is a new request
      // Notify the other player that someone wants to renew
      mg.displayMessage(
        "events_display.wants_to_renew_alliance",
        MessageType.RENEW_ALLIANCE,
        this.toID,
        undefined,
        { name: this.from.displayName() },
      );
    }
  }

  tick(ticks: number): void {
    // No-op - extension request is processed immediately in init()
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
