import { Game } from "../../src/core/game/Game";

export function executeTicks(game: Game, numTicks: number): void {
  for (let i = 0; i < numTicks; i++) {
    game.executeNextTick();
  }
}
