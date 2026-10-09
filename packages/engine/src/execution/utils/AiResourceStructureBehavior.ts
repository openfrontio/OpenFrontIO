import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { randTerritoryTileArray } from "../nation/NationUtils";
import { ConstructionExecution } from "../ConstructionExecution";
import { Game, Player, Unit } from "../../game/Game";

export const AI_RESOURCE_STRUCTURE_TYPES = [
  UnitType.LivestockFarm,
  UnitType.OilMine,
  UnitType.GoldMine,
  UnitType.DiamondMine,
] as const;

const RESOURCE_TILE_SAMPLES = 32;
const RAIL_PLACEMENT_RADIUS = 3;

/**
 * Lets non-human AI players build and upgrade the resource structures that
 * humans can build. The behavior is intentionally scoped to the newly added
 * resource structures and leaves the existing nation/tribe AI untouched:
 *
 * - upgrades existing resource structures when the upgrade is the best use of
 *   available gold;
 * - prefers Oil Mines close to friendly factories;
 * - prefers all resource mines close to existing railroads;
 * - otherwise falls back to the normal affordable resource-building choice.
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

    const bestUpgrade = this.findBestUpgrade();
    const bestBuild = this.findBestBuild();

    if (
      bestUpgrade !== null &&
      (bestBuild === null || bestUpgrade.score >= bestBuild.score)
    ) {
      this.player.upgradeUnit(bestUpgrade.unit);
      return true;
    }

    if (bestBuild !== null) {
      this.game.addExecution(
        new ConstructionExecution(
          this.player,
          bestBuild.type,
          bestBuild.tile,
        ),
      );
      return true;
    }

    return false;
  }

  private findBestUpgrade(): { unit: Unit; score: number } | null {
    let best: { unit: Unit; score: number } | null = null;

    for (const type of AI_RESOURCE_STRUCTURE_TYPES) {
      if (this.game.config().isUnitDisabled(type)) continue;

      const income = Number(
        this.game.config().mineIncome(type, 1, this.player),
      );
      const farmBonus = type === UnitType.LivestockFarm ? 1.1 : 1;
      const countPenalty =
        1 / (1 + Math.max(0, this.player.unitsOwned(type)));

      for (const unit of this.player.units(type)) {
        if (
          !unit.isActive() ||
          unit.isUnderConstruction() ||
          unit.isMarkedForDeletion()
        ) {
          continue;
        }
        if (!this.player.canUpgradeUnit(unit)) continue;

        const cost = Number(
          this.game.unitInfo(type).cost(this.game, this.player),
        );
        if (this.player.gold() < BigInt(Math.ceil(cost))) continue;

        // Keep building missing resource types competitive with upgrades while
        // still letting profitable upgrades happen when the AI already has
        // coverage of the resource types it can use.
        const score =
          (income / Math.max(1, cost)) *
          countPenalty *
          farmBonus *
          0.9;

        if (best === null || score > best.score) {
          best = { unit, score };
        }
      }
    }

    return best;
  }

  private findBestBuild(): {
    type: UnitType;
    tile: TileRef;
    score: number;
  } | null {
    let best: {
      type: UnitType;
      tile: TileRef;
      score: number;
    } | null = null;

    for (const type of AI_RESOURCE_STRUCTURE_TYPES) {
      if (this.game.config().isUnitDisabled(type)) continue;

      const cost = this.game.unitInfo(type).cost(this.game, this.player);
      if (this.player.gold() < cost) continue;

      const candidates = randTerritoryTileArray(
        this.random,
        this.game,
        this.player,
        RESOURCE_TILE_SAMPLES,
      );

      for (const tile of candidates) {
        const spawnTile = this.player.canBuild(type, tile);
        if (spawnTile === false) continue;

        const score =
          this.structureScore(type) * this.placementScore(type, spawnTile);

        if (best === null || score > best.score) {
          best = {
            type,
            tile: spawnTile,
            score,
          };
        }
      }
    }

    return best;
  }

  private structureScore(type: UnitType): number {
    const cost = Number(this.game.unitInfo(type).cost(this.game, this.player));
    const income = Number(
      this.game.config().mineIncome(type, 1, this.player),
    );
    const count = this.player.unitsOwned(type);
    const countPenalty = 1 / (1 + count);
    const missingTypeBonus = count === 0 ? 2 : 1;
    const farmBonus = type === UnitType.LivestockFarm ? 1.1 : 1;

    return (
      (income / Math.max(1, cost)) *
      countPenalty *
      missingTypeBonus *
      farmBonus
    );
  }

  private placementScore(type: UnitType, tile: TileRef): number {
    let score = 1;

    if (
      type === UnitType.OilMine ||
      type === UnitType.GoldMine ||
      type === UnitType.DiamondMine
    ) {
      score *= this.railroadPlacementScore(type, tile);
    }

    if (type === UnitType.OilMine) {
      score *= this.oilFactoryPlacementScore(tile);
    }

    return score;
  }

  private oilFactoryPlacementScore(tile: TileRef): number {
    const factories = this.player
      .units(UnitType.Factory)
      .filter(
        (factory) =>
          factory.isActive() &&
          !factory.isUnderConstruction() &&
          !factory.isMarkedForDeletion(),
      );

    if (factories.length === 0) {
      return 0.85;
    }

    const maxRange = Math.max(1, this.game.config().trainStationMaxRange());
    let nearestDistance = Infinity;

    for (const factory of factories) {
      nearestDistance = Math.min(
        nearestDistance,
        this.game.map().manhattanDist(tile, factory.tile()),
      );
    }

    if (nearestDistance > maxRange) {
      return 0.9;
    }

    const closeness = (maxRange - nearestDistance + 1) / maxRange;
    return 1 + closeness * 3;
  }

  private railroadPlacementScore(type: UnitType, tile: TileRef): number {
    const railTiles = this.game
      .railNetwork()
      .overlappingRailroads(type, tile);

    if (railTiles.length === 0) {
      return 1;
    }

    let nearestDistance = RAIL_PLACEMENT_RADIUS + 1;
    for (const railTile of railTiles) {
      nearestDistance = Math.min(
        nearestDistance,
        this.game.map().manhattanDist(tile, railTile),
      );
    }

    if (nearestDistance > RAIL_PLACEMENT_RADIUS) {
      return 1;
    }

    const closeness =
      (RAIL_PLACEMENT_RADIUS - nearestDistance + 1) /
      (RAIL_PLACEMENT_RADIUS + 1);
    return 1 + closeness * 1.5;
  }
}
