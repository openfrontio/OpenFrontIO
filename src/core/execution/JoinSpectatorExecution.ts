import { Execution, Game } from "../game/Game";
import { ClientID } from "../Schemas";

/**
 * Execution handler for JoinSpectatorIntent.
 * Adds the client to the game's spectator list.
 */
export class JoinSpectatorExecution implements Execution {
  private mg: Game | null = null;

  constructor(private clientID: ClientID) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    // if already a spectator, do nothing
    if (this.mg.isSpectator(this.clientID)) {
      return;
    }

    // Add to spectators
    this.mg.addSpectator(this.clientID);
  }

  tick(ticks: number): void {}
}
