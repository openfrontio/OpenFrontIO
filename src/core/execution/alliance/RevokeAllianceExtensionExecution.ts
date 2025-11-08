import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";

export class RevokeAllianceExtensionExecution implements Execution {
  constructor(
    private readonly from: Player,
    private readonly toID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[RevokeAllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }
    const to = mg.player(this.toID);

    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[RevokeAllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[RevokeAllianceExtensionExecution] No alliance to revoke extension between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Check if this player had requested an extension
    const hadRequestedExtension = alliance.hasRequestedExtension(this.from);

    // Remove this player's extension request
    alliance.removeExtensionRequest(this.from);

    // Send message to the other player if they had requested an extension
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
    // No-op
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
