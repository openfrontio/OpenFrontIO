import { Execution, Game, Player, PlayerID } from "../game/Game";

export class MarkIdleExecution implements Execution {
  private player: Player;
  private active: boolean = true;

  constructor(
    private playerID: PlayerID,
    private isIdle: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(
        `MarkIdleExecution: player ${this.playerID} not found in game`,
      );
      this.active = false;
      return;
    }

    this.player = mg.player(this.playerID);
    if (!this.player) {
      console.warn(
        `MarkIdleExecution: failed to retrieve player ${this.playerID}`,
      );
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    this.player.markIdle(this.isIdle);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
