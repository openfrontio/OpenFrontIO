import { consolex } from "../Consolex";

import { Execution, Game, Player, PlayerID } from "../game/Game";

export class MarkAFKExecution implements Execution {
  private player: Player;
  private mg: Game;
  private active: boolean = true;

  constructor(
    private playerID: PlayerID,
    private isAFK: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(`MarkAFKExecution: client ${this.playerID} not found`);
      this.active = false;
      return;
    }

    this.player = mg.player(this.playerID);
  }

  tick(ticks: number): void {
    if (this.player) {
      if (this.player.isAFK() === this.isAFK) {
        consolex.warn("The player is already in the correct AFK state");
      }
      this.player.markAFK(this.isAFK);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
