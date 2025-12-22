import { Execution, Game } from "../game/Game";

export class PauseExecution implements Execution {
  constructor(private paused: boolean) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(game: Game, ticks: number): void {
    game.setPaused(this.paused);
  }

  tick(ticks: number): void {}
}
