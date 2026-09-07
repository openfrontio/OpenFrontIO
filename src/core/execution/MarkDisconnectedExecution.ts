import { Execution, Game, Player } from "../game/Game";

export class MarkDisconnectedExecution implements Execution {
  constructor(
    private player: Player,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    const team = this.player.team();
    const teamLandShare = team ? mg.teamLandShare(team) : 0;
    this.player.markDisconnected(this.isDisconnected, ticks, teamLandShare);
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
