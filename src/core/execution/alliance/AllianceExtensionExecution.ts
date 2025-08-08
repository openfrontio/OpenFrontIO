import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";

export class AllianceExtensionExecution implements Execution {
  constructor(
    private readonly from: Player,
    private readonly toID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[AllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }
    const to = mg.player(this.toID);

    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[AllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance to extend between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Mark this player's intent to extend
    alliance.addExtensionRequest(this.from);

    if (alliance.bothAgreedToExtend()) {
      alliance.extend();

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
