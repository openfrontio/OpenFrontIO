import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
} from "../../game/Game";

export class AllianceExtensionExecution implements Execution {
  private isDone = false;

  constructor(
    private readonly from: Player,
    private readonly to: Player,
  ) {}

  isActive(): boolean {
    return !this.isDone;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    const from = this.from;
    const alliance = from.allianceWith(this.to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance to extend between ${from.id()} and ${this.to.id()}`,
      );
      this.isDone = true;
      return;
    }

    // Mark this player's intent to extend
    alliance.requestExtension(from);

    // If the other player is a bot or fake human, request extension on their behalf
    if (
      this.to.type &&
      typeof this.to.type === "function" &&
      (this.to.type() === PlayerType.Bot ||
        this.to.type() === PlayerType.FakeHuman)
    ) {
      alliance.requestExtension(this.to);
    }

    // Only extend if both players want it
    if (alliance.wantsExtension()) {
      alliance.extendDuration(ticks);

      // Inform both players about the successful extension
      mg.displayMessage(
        "alliance.renewed",
        MessageType.ALLIANCE_ACCEPTED,
        from.id(),
      );
      mg.displayMessage(
        "alliance.renewed",
        MessageType.ALLIANCE_ACCEPTED,
        this.to.id(),
      );
    }

    this.isDone = true;
  }

  tick(ticks: number): void {
    // No-op
  }
}
