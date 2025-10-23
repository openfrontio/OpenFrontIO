import { UnitType } from "../../../game/Game";
import { ConstructionExecution } from "../../ConstructionExecution";
import { structureSpawnTileValue } from "../../nation/structureSpawnTileValue";
import { BaseAdvisor } from "../core/BaseAdvisor";
import { ActionRecommendation, AdvisorPriority } from "../core/types";
import { randCoastalTileArray, randTerritoryTileArray } from "../utils/utils";

/**
 * Economy advisor handles structure building and economic decisions
 * Manages build order, structure placement, and warship construction
 */
export class EconomyAdvisor extends BaseAdvisor {
  /**
   * Analyze current game state and recommend economic actions
   */
  recommend(): ActionRecommendation | null {
    const buildOrder = this.getBuildOrder();

    for (const { type, multiplier } of buildOrder) {
      if (type === UnitType.Warship) {
        const warshipRec = this.recommendWarship();
        if (warshipRec) return warshipRec;
      } else {
        const structureRec = this.recommendStructure(type, multiplier);
        if (structureRec) return structureRec;
      }
    }

    return null;
  }

  /**
   * Get the current build order - simplified to match original logic
   */
  private getBuildOrder(): Array<{
    type: UnitType;
    multiplier: (num: number) => number;
  }> {
    return [
      { type: UnitType.City, multiplier: (num: number) => num },
      { type: UnitType.Port, multiplier: (num: number) => num },
      { type: UnitType.Warship, multiplier: () => 0 }, // Special case handled separately
      { type: UnitType.Factory, multiplier: (num: number) => num },
      {
        type: UnitType.DefensePost,
        multiplier: (num: number) => (num + 2) ** 2,
      },
      { type: UnitType.SAMLauncher, multiplier: (num: number) => num ** 2 },
      { type: UnitType.MissileSilo, multiplier: (num: number) => num ** 2 },
    ];
  }

  /**
   * Recommend building a specific structure type
   */
  private recommendStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ): ActionRecommendation | null {
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);

    if (this.player.gold() < perceivedCost) {
      return null;
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return null;
    }

    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return null;
    }

    return {
      execute: () => {
        this.game.addExecution(
          new ConstructionExecution(this.player, type, tile),
        );
      },
      score: this.calculateStructureScore(type, owned),
      priority: AdvisorPriority.Normal,
      description: `Build ${type} at tile ${tile}`,
    };
  }

  /**
   * Recommend building a warship
   */
  private recommendWarship(): ActionRecommendation | null {
    if (!this.random.chance(50)) {
      return null;
    }

    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    const warshipCost = this.cost(UnitType.Warship);

    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() > warshipCost
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile === null) {
        return null;
      }

      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        console.warn("cannot spawn destroyer");
        return null;
      }

      return {
        execute: () => {
          this.game.addExecution(
            new ConstructionExecution(
              this.player,
              UnitType.Warship,
              targetTile,
            ),
          );
        },
        score: 100, // High score for first warship
        priority: AdvisorPriority.High,
        description: `Build warship near port at tile ${targetTile}`,
      };
    }

    return null;
  }

  /**
   * Find the best tile to spawn a structure
   */
  private structureSpawnTile(
    type: UnitType,
  ): import("../../../game/GameMap").TileRef | null {
    const tiles =
      type === UnitType.Port
        ? randCoastalTileArray(this.game, this.player, this.random, 25)
        : randTerritoryTileArray(this.game, this.player, this.random, 25);

    if (tiles.length === 0) return null;

    const valueFunction = structureSpawnTileValue(this.game, this.player, type);
    let bestTile: import("../../../game/GameMap").TileRef | null = null;
    let bestValue = 0;

    for (const t of tiles) {
      const v = valueFunction(t);
      if (v <= bestValue && bestTile !== null) continue;
      if (!this.player.canBuild(type, t)) continue;
      // Found a better tile
      bestTile = t;
      bestValue = v;
    }

    return bestTile;
  }

  /**
   * Find a suitable tile to spawn a warship near a port
   */
  private warshipSpawnTile(
    portTile: import("../../../game/GameMap").TileRef,
  ): import("../../../game/GameMap").TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.game.x(portTile) - radius,
        this.game.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.game.y(portTile) - radius,
        this.game.y(portTile) + radius,
      );
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.game.ref(randX, randY);
      // Sanity check
      if (!this.game.isOcean(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  /**
   * Calculate score for building a structure based on type and current count
   */
  private calculateStructureScore(type: UnitType, owned: number): number {
    // Base scores for different structure types
    const baseScores: Partial<Record<UnitType, number>> = {
      [UnitType.City]: 100,
      [UnitType.Port]: 80,
      [UnitType.Factory]: 60,
      [UnitType.DefensePost]: 40,
      [UnitType.SAMLauncher]: 30,
      [UnitType.MissileSilo]: 90,
      [UnitType.Warship]: 0, // Handled separately
    };

    const baseScore = baseScores[type] ?? 50;

    // Reduce score based on how many we already have (diminishing returns)
    const diminishingFactor = Math.max(0.1, 1 / (owned + 1));

    return Math.floor(baseScore * diminishingFactor);
  }
}
