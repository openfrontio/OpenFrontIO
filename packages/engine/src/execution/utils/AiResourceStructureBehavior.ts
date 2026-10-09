import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { randTerritoryTileArray } from "../nation/NationUtils";
import { ConstructionExecution } from "../ConstructionExecution";
import { Game, Player } from "../../game/Game";

export const AI_RESOURCE_STRUCTURE_TYPES = [
  UnitType.LivestockFarm,
  UnitType.OilMine,
  UnitType.GoldMine,
  UnitType.DiamondMine,
] as const;

const RESOURCE_TILE_SAMPLES = 32;

/**
 * Lets non-human AI players build the resource structures that humans can
 * build. The behavior is intentionally small and shared by nations and tribes:
 * pick the affordable structure with the best income-per-cost score, then place
 * it on a random owned tile that passes the normal build checks.
 */
export class AiResourceStructureBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  handleStructures(): boolean {
    if (!this.game.config().aiResourceStructures()) {
      return false;
    }
    if (!this.player.isAlive() || this.player.numTilesOwned() === 0) {
      return false;
    }

    let bestType: UnitType | null = null;
    let bestScore = -Infinity;

    for (const type of AI_RESOURCE_STRUCTURE_TYPES) {
      if (this.game.config().isUnitDisabled(type)) continue;

      const cost = this.game.unitInfo(type).cost(this.game, this.player);
      if (this.player.gold() < cost) continue;

      // Farm income also improves troop capacity/growth, so give it a small
      // preference while still letting the more profitable mines compete.
      const income = Number(
        this.game.config().mineIncome(type, 1, this.player),
      );
      const countPenalty = 1 / (1 + this.player.unitsOwned(type));
      const farmBonus = type === UnitType.LivestockFarm ? 1.1 : 1;
      const score =
        (income / Math.max(1, Number(cost))) * countPenalty * farmBonus;

      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    if (bestType === null) {
      return false;
    }

    const tile = this.findBuildTile(bestType);
    if (tile === null) {
      return false;
    }

    this.game.addExecution(
      new ConstructionExecution(this.player, bestType, tile),
    );
    return true;
  }

  private findBuildTile(type: UnitType): TileRef | null {
    const candidates = randTerritoryTileArray(
      this.random,
      this.game,
      this.player,
      RESOURCE_TILE_SAMPLES,
    );

    for (const tile of candidates) {
      if (this.player.canBuild(type, tile) !== false) {
        return tile;
      }
    }

    return null;
  }
}
