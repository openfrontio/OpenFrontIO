import { Execution, Game, MessageType, Player } from "../game/Game";
import { GameUpdateType, PingPlacedUpdate } from "../game/GameUpdates";
import { PingType } from "../game/Ping";

export class PingExecution implements Execution {
  constructor(
    private sender: Player,
    private pingType: PingType,
    private x: number,
    private y: number,
  ) {}

  init(game: Game): void {
    const recipients = game
      .players()
      .filter((p) => p.isFriendly(this.sender, true));

    for (const recipient of recipients) {
      // Create chat message
      const message = `${this.sender.name()} pinged ${this.pingType}`;
      game.displayMessage(message, MessageType.CHAT, recipient.id());

      // Create visual ping update
      game.addUpdate({
        type: GameUpdateType.PingPlaced,
        playerID: recipient.smallID(),
        senderID: this.sender.smallID(),
        pingType: this.pingType,
        x: this.x,
        y: this.y,
      } as PingPlacedUpdate);
    }
  }

  tick(ticks: number): void {
    // Pings are instantaneous, no need for tick logic
  }

  isActive(): boolean {
    return false; // It's an instantaneous event
  }

  activeDuringSpawnPhase(): boolean {
    return true; // Pings can be used anytime
  }
}
