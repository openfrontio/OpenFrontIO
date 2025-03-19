// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// However buildUnit do not create executions (e.g.: WarshipExecution)
// If you also need execution use function below. Does not work with things not

import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { Game, PlayerID, UnitType } from "../../src/core/game/Game";

// built via UI (e.g.: trade ships)
export function constructionExecution(
  game: Game,
  playerID: PlayerID,
  x: number,
  y: number,
  unit: UnitType,
) {
  game.addExecution(new ConstructionExecution(playerID, game.ref(x, y), unit));
  // Init
  game.executeNextTick();
  // Exec
  game.executeNextTick();
  game.executeNextTick();
}
