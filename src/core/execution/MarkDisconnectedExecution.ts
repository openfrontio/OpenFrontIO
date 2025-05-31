import { Execution, Game, Player, PlayerID } from "../game/Game";

export class MarkDisconnectedExecution implements Execution {
  private player: Player;
  private active: boolean = true;

  constructor(
    private playerID: PlayerID,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(
        `MarkDisconnectedExecution: player ${this.playerID} not found in game`,
      );
      this.active = false;
      return;
    }

    this.player = mg.player(this.playerID);
    if (!this.player) {
      console.warn(
        `MarkDisconnectedExecution: failed to retrieve player ${this.playerID}`,
      );
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    this.player.markDisconnected(this.isDisconnected);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
