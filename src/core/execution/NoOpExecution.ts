import { Execution, Game } from "../game/Game";

export class NoOpExecution implements Execution {
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  init(_mg: Game, _ticks: number): void {}
  tick(_ticks: number): void {}
}
