import { Execution, Game, Player, PlayerID } from "../game/Game";

export class SetTargetTroopRatioExecution implements Execution {
  private player: Player;

  private active = true;

  constructor(
    private playerID: PlayerID,
    private targetTroopsRatio: number,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(
        `SetTargetTRoopRatioExecution: player ${this.playerID} not found`,
      );
    }
    this.player = mg.player(this.playerID);
  }

  tick(ticks: number): void {
    if (this.targetTroopsRatio < 0 || this.targetTroopsRatio > 1) {
      console.warn(
        `target troop ratio of ${this.targetTroopsRatio} for player ${this.player} invalid`,
      );
    } else {
      this.player.setTargetTroopRatio(this.targetTroopsRatio);
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
