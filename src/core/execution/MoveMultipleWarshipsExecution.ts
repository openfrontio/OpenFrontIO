import { Execution, Game, Player } from "../game/Game";
import { MoveWarshipExecution } from "./MoveWarshipExecution";

/**
 * Fans out a multi-warship move command into individual MoveWarshipExecutions.
 * This keeps the intent atomic on the wire while reusing existing move logic.
 */
export class MoveMultipleWarshipsExecution implements Execution {
  constructor(
    private readonly player: Player,
    private readonly unitIds: number[],
    private readonly tile: number,
  ) {}

  init(game: Game, ticks: number): void {
    for (const unitId of this.unitIds) {
      new MoveWarshipExecution(this.player, unitId, this.tile).init(
        game,
        ticks,
      );
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
