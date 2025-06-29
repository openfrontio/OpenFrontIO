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
    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance to extend between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    // Mark this player's intent to extend
    alliance.addExtensionRequest(this.from);

    if (alliance.canExtend()) {
      alliance.extend();

      mg.displayMessage(
        "alliance.renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.from.id(),
      );
      mg.displayMessage(
        "alliance.renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.toID,
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
