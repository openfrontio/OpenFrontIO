// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// However buildUnit do not create executions (e.g.: WarshipExecution)
// If you also need execution use function below. Does not work with things not

import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { Game, Player, UnitType } from "../../src/core/game/Game";

// built via UI (e.g.: trade ships)
export function constructionExecution(
  game: Game,
  _owner: Player,
  x: number,
  y: number,
  unit: UnitType,
  ticks = 4,
) {
  game.addExecution(new ConstructionExecution(_owner, game.ref(x, y), unit));

  // 4 ticks by default as it usually goes like this
  // Init of construction execution
  // Exec construction execution
  // Tick of construction execution which adds the execution related to the building/unit
  // First tick of the execution of the constructed building/unit
  // (sometimes step 3 and 4 are merged in one)

  for (let i = 0; i < ticks; i++) {
    game.executeNextTick();
  }
}

export function executeTicks(game: Game, numTicks: number): void {
  for (let i = 0; i < numTicks; i++) {
    game.executeNextTick();
  }
}
