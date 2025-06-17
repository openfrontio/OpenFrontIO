import { Execution, Game, MessageType, Player } from "../../game/Game";

export class AllianceExtensionExecution implements Execution {
  private isDone = false;

  constructor(private readonly to: Player) {}

  isActive(): boolean {
    return !this.isDone;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    const from = mg.myPlayer();
    const alliance = from.allianceWith(this.to);
    if (!alliance) {
      mg.displayMessage(
        "No alliance to extend.",
        MessageType.ALLIANCE_REJECTED,
        from.id(),
      );
      this.isDone = true;
      return;
    }

    // Extends excisting alliance by the specified ticks
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

    this.isDone = true;
  }

  tick(ticks: number): void {
    // No-op
  }
}
