import { Execution, Game, Player } from "../game/Game";

export class MarkDisconnectedExecution implements Execution {
  constructor(
    private player: Player,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    const team = this.player.team();
    const teamTiles = team ? mg.teamTilesOwned(team) : 0;
    const totalLand = mg.totalLandTiles();
    this.player.markDisconnected(
      this.isDisconnected,
      ticks,
      teamTiles,
      totalLand,
    );
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
