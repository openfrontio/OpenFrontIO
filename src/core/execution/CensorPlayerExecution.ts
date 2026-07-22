import { Execution, Game, Player } from "../game/Game";

// Server-injected (username moderation): replaces the player's displayed name
// with the username carried by the intent — a shadow name when the API bans a
// name, the original name when a ban clears.
export class CensorPlayerExecution implements Execution {
  constructor(
    private player: Player,
    private username: string,
  ) {}

  init(mg: Game, ticks: number): void {
    this.player.rename(this.username);
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
