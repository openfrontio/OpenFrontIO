import {
  Game,
  Gold,
  Player,
  PlayerType,
  Relation,
  StructureTypes,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { closestTile, closestTwoTiles } from "../Util";
import { randTerritoryTileArray } from "./NationUtils";

/**
 * Configuration for how many structures of each type a nation should build
 * relative to the number of cities it owns.
 */
interface StructureRatioConfig {
  /** How many of this structure per city (e.g., 0.75 means 3 ports for every 4 cities) */
  ratioPerCity: number;
  /** Perceived cost increase percentage per owned structure (e.g., 0.1 = 10% more expensive per owned) */
  perceivedCostIncreasePerOwned: number;
}

/**
 * Default structure ratios relative to city count.
 * Cities are always prioritized and built first.
 */
const STRUCTURE_RATIOS: Partial<Record<UnitType, StructureRatioConfig>> = {
  [UnitType.Port]: { ratioPerCity: 0.75, perceivedCostIncreasePerOwned: 1 },
  [UnitType.Factory]: { ratioPerCity: 0.75, perceivedCostIncreasePerOwned: 1 },
  [UnitType.DefensePost]: {
    ratioPerCity: 0.25,
    perceivedCostIncreasePerOwned: 1,
  },
  [UnitType.SAMLauncher]: {
    ratioPerCity: 0.25,
    perceivedCostIncreasePerOwned: 1,
  },
  [UnitType.MissileSilo]: {
    ratioPerCity: 0.25,
    perceivedCostIncreasePerOwned: 1,
  },
};

/** Perceived cost increase percentage per city owned */
const CITY_PERCEIVED_COST_INCREASE_PER_OWNED = 1;

/** If we have more than this many structures per 1000 tiles, prefer upgrading over building */
const UPGRADE_DENSITY_THRESHOLD = 1 / 1000;

/** Maximum number of structures a nation can build or upgrade per tick */
const MAX_STRUCTURES_PER_TICK = 5;

export class NationStructureBehavior {
  /**
   * Tracks gold committed to queued constructions/upgrades this tick.
   * Since addExecution() defers gold deduction to a later tick, we need
   * to track spending locally to avoid overspending.
   */
  private goldCommitted: Gold = 0n;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  /**
   * Returns the player's gold minus gold already committed to queued
   * constructions/upgrades this tick.
   */
  private availableGold(): Gold {
    return this.player.gold() - this.goldCommitted;
  }

  handleUnits(): boolean {
    this.goldCommitted = 0n;
    let built = 0;

    // Build order for non-city structures (priority order)
    const buildOrder: UnitType[] = [
      UnitType.DefensePost,
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];

    // Keep looping until we can't build anything or hit the MAX_STRUCTURES_PER_TICK cap
    let builtThisPass = true;
    while (builtThisPass && built < MAX_STRUCTURES_PER_TICK) {
      builtThisPass = false;
      const cityCount = this.player.unitsOwned(UnitType.City);
      const hasCoastalTiles = this.hasCoastalTiles();

      for (const structureType of buildOrder) {
        if (built >= MAX_STRUCTURES_PER_TICK) break;

        // Skip ports if no coastal tiles
        if (structureType === UnitType.Port && !hasCoastalTiles) {
          continue;
        }

        if (
          this.shouldBuildStructure(structureType, cityCount, hasCoastalTiles)
        ) {
          if (this.maybeSpawnStructure(structureType)) {
            built++;
            builtThisPass = true;
          }
        }
      }

      if (built < MAX_STRUCTURES_PER_TICK) {
        if (this.maybeSpawnStructure(UnitType.City)) {
          built++;
          builtThisPass = true;
        }
      }
    }

    return built > 0;
  }

  private hasCoastalTiles(): boolean {
    for (const tile of this.player.borderTiles()) {
      if (this.game.isOceanShore(tile)) return true;
    }
    return false;
  }

  /**
   * Determines if we should build more of this structure type based on
   * the current city count and the configured ratio.
   */
  private shouldBuildStructure(
    type: UnitType,
    cityCount: number,
    hasCoastalTiles: boolean,
  ): boolean {
    const config = STRUCTURE_RATIOS[type];
    if (config === undefined) {
      return false;
    }

    let ratio = config.ratioPerCity;

    // Heavily reduce factory spawning if we have coastal tiles
    if (type === UnitType.Factory && hasCoastalTiles) {
      ratio *= 0.25;
    }

    const owned = this.player.unitsOwned(type);
    const targetCount = Math.floor(cityCount * ratio);

    return owned < targetCount;
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }

  private maybeSpawnStructure(type: UnitType): boolean {
    const perceivedCost = this.getPerceivedCost(type);
    if (this.availableGold() < perceivedCost) {
      return false;
    }

    // Check if we should upgrade instead of building new
    if (this.maybeUpgradeStructure(this.player.units(type))) {
      return true;
    }

    const realCost = this.cost(type);
    if (this.availableGold() < realCost) {
      return false;
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.game.addExecution(new ConstructionExecution(this.player, type, tile));
    this.goldCommitted += realCost;
    return true;
  }

  /**
   * Calculates the perceived cost for a structure type.
   * The perceived cost increases by a percentage for each structure of that type already owned.
   * This makes nations save up gold for MIRVs.
   * Once the nation can afford both a MIRV and a Hydrogen Bomb, stop inflating costs.
   */
  private getPerceivedCost(type: UnitType): Gold {
    const realCost = this.cost(type);

    // If we can afford both MIRV and Hydrogen Bomb, no need to save up anymore
    const mirvCost = this.cost(UnitType.MIRV);
    const hydroCost = this.cost(UnitType.HydrogenBomb);
    if (this.availableGold() >= mirvCost + hydroCost) {
      return realCost;
    }

    const owned = this.player.unitsOwned(type);

    let increasePerOwned: number;
    if (type === UnitType.City) {
      increasePerOwned = CITY_PERCEIVED_COST_INCREASE_PER_OWNED;
    } else {
      const config = STRUCTURE_RATIOS[type];
      increasePerOwned = config?.perceivedCostIncreasePerOwned ?? 0.1;
    }

    // Each owned structure makes the next one feel more expensive
    // Formula: realCost * (1 + increasePerOwned * owned)
    const multiplier = 1 + increasePerOwned * owned;
    return BigInt(Math.ceil(Number(realCost) * multiplier));
  }

  /**
   * Tries to upgrade an existing structure if density threshold is exceeded.
   * @param structures The pool of structures to consider for upgrading
   * @returns true if an upgrade was initiated, false otherwise
   */
  private maybeUpgradeStructure(structures: Unit[]): boolean {
    if (this.getTotalStructureDensity() <= UPGRADE_DENSITY_THRESHOLD) {
      return false;
    }
    if (structures.length === 0) {
      return false;
    }
    const structureToUpgrade = this.findBestStructureToUpgrade(structures);
    if (
      structureToUpgrade !== null &&
      this.player.canUpgradeUnit(structureToUpgrade)
    ) {
      const upgradeCost = this.cost(structureToUpgrade.type());
      if (this.availableGold() < upgradeCost) {
        return false;
      }
      this.game.addExecution(
        new UpgradeStructureExecution(this.player, structureToUpgrade.id()),
      );
      this.goldCommitted += upgradeCost;
      return true;
    }
    return false;
  }

  /**
   * Calculates total structure density across player's territory.
   */
  private getTotalStructureDensity(): number {
    let totalStructures = 0;
    for (const type of StructureTypes) {
      totalStructures += this.player.units(type).length; // ignoring levels
    }
    const tilesOwned = this.player.numTilesOwned();
    return tilesOwned > 0 ? totalStructures / tilesOwned : 0;
  }

  /**
   * Finds the best structure to upgrade, preferring structures protected by a SAM.
   */
  private findBestStructureToUpgrade(structures: Unit[]): Unit | null {
    if (structures.length === 0) {
      return null;
    }

    const samLaunchers = this.player.units(UnitType.SAMLauncher);
    const samRange = this.game.config().defaultSamRange();
    const samRangeSquared = samRange * samRange;

    // Score each structure based on SAM protection
    let bestStructure: Unit | null = null;
    let bestScore = -1;

    for (const structure of structures) {
      if (!this.player.canUpgradeUnit(structure)) {
        continue;
      }

      let score = 0;

      // Check if protected by any SAM
      for (const sam of samLaunchers) {
        const distSquared = this.game.euclideanDistSquared(
          structure.tile(),
          sam.tile(),
        );
        if (distSquared <= samRangeSquared) {
          // Protected by this SAM, add score based on SAM level
          score += 10;
          if (sam.level() > 1) {
            score += (sam.level() - 1) * 7.5;
          }
        }
      }

      // Add small random factor to break ties
      score += this.random.nextInt(0, 5);

      if (score > bestScore) {
        bestScore = score;
        bestStructure = structure;
      }
    }

    return bestStructure;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : randTerritoryTileArray(this.random, this.game, this.player, 25);
    if (tiles.length === 0) return null;
    const valueFunction = this.structureSpawnTileValue(type);
    if (valueFunction === null) return null;
    let bestTile: TileRef | null = null;
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

  private randCoastalTileArray(numTiles: number): TileRef[] {
    const tiles = Array.from(this.player.borderTiles()).filter((t) =>
      this.game.isOceanShore(t),
    );
    return Array.from(this.arraySampler(tiles, numTiles));
  }

  private *arraySampler<T>(a: T[], sampleSize: number): Generator<T> {
    if (a.length <= sampleSize) {
      // Return all elements
      yield* a;
    } else {
      // Sample `sampleSize` elements
      const remaining = new Set<T>(a);
      while (sampleSize--) {
        const t = this.random.randFromSet(remaining);
        remaining.delete(t);
        yield t;
      }
    }
  }

  private structureSpawnTileValue(
    type: UnitType,
  ): ((tile: TileRef) => number) | null {
    const mg = this.game;
    const player = this.player;
    const borderTiles = player.borderTiles();
    const otherUnits = player.units(type);
    // Prefer spacing structures out of atom bomb range
    const borderSpacing = mg.config().nukeMagnitudes(UnitType.AtomBomb).outer;
    const structureSpacing = borderSpacing * 2;
    switch (type) {
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.MissileSilo: {
        return (tile) => {
          let w = 0;

          // Prefer higher elevations
          w += mg.magnitude(tile);

          // Prefer to be away from the border
          const [, closestBorderDist] = closestTile(mg, borderTiles, tile);
          w += Math.min(closestBorderDist, borderSpacing);

          // Prefer to be away from other structures of the same type
          const otherTiles: Set<TileRef> = new Set(
            otherUnits.map((u) => u.tile()),
          );
          otherTiles.delete(tile);
          const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
          if (closestOther !== null) {
            const d = mg.manhattanDist(closestOther.x, tile);
            w += Math.min(d, structureSpacing);
          }

          // TODO: Cities and factories should consider train range limits
          return w;
        };
      }
      case UnitType.Port: {
        return (tile) => {
          let w = 0;

          // Prefer to be away from other structures of the same type
          const otherTiles: Set<TileRef> = new Set(
            otherUnits.map((u) => u.tile()),
          );
          otherTiles.delete(tile);
          const [, closestOtherDist] = closestTile(mg, otherTiles, tile);
          w += Math.min(closestOtherDist, structureSpacing);

          return w;
        };
      }
      case UnitType.DefensePost: {
        // Check if we have any non-friendly non-bot neighbors
        const hasHostileNeighbor =
          player
            .neighbors()
            .filter(
              (n): n is Player =>
                n.isPlayer() &&
                player.isFriendly(n) === false &&
                n.type() !== PlayerType.Bot,
            ).length > 0;

        // Don't build defense posts if there is no danger
        if (!hasHostileNeighbor) {
          return null;
        }

        return (tile) => {
          let w = 0;

          // Prefer higher elevations
          w += mg.magnitude(tile);

          const [closest, closestBorderDist] = closestTile(
            mg,
            borderTiles,
            tile,
          );
          if (closest !== null) {
            // Prefer to be borderSpacing tiles from the border
            w += Math.max(
              0,
              borderSpacing - Math.abs(borderSpacing - closestBorderDist),
            );

            // Prefer adjacent players who are hostile
            const neighbors: Set<Player> = new Set();
            for (const tile of mg.neighbors(closest)) {
              if (!mg.isLand(tile)) continue;
              const id = mg.ownerID(tile);
              if (id === player.smallID()) continue;
              const neighbor = mg.playerBySmallID(id);
              if (!neighbor.isPlayer()) continue;
              if (neighbor.type() === PlayerType.Bot) continue;
              neighbors.add(neighbor);
            }
            for (const neighbor of neighbors) {
              w +=
                borderSpacing * (Relation.Friendly - player.relation(neighbor));
            }
          }

          // Prefer to be away from other structures of the same type
          const otherTiles: Set<TileRef> = new Set(
            otherUnits.map((u) => u.tile()),
          );
          otherTiles.delete(tile);
          const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
          if (closestOther !== null) {
            const d = mg.manhattanDist(closestOther.x, tile);
            w += Math.min(d, structureSpacing);
          }

          return w;
        };
      }
      case UnitType.SAMLauncher: {
        const protectTiles: Set<TileRef> = new Set();
        for (const unit of player.units()) {
          switch (unit.type()) {
            case UnitType.City:
            case UnitType.Factory:
            case UnitType.MissileSilo:
            case UnitType.Port:
              protectTiles.add(unit.tile());
          }
        }
        const range = mg.config().defaultSamRange();
        const rangeSquared = range * range;
        return (tile) => {
          let w = 0;

          // Prefer higher elevations
          w += mg.magnitude(tile);

          // Prefer to be away from the border
          const closestBorder = closestTwoTiles(mg, borderTiles, [tile]);
          if (closestBorder !== null) {
            const d = mg.manhattanDist(closestBorder.x, tile);
            w += Math.min(d, borderSpacing);
          }

          // Prefer to be away from other structures of the same type
          const otherTiles: Set<TileRef> = new Set(
            otherUnits.map((u) => u.tile()),
          );
          otherTiles.delete(tile);
          const closestOther = closestTwoTiles(mg, otherTiles, [tile]);
          if (closestOther !== null) {
            const d = mg.manhattanDist(closestOther.x, tile);
            w += Math.min(d, structureSpacing);
          }

          // Prefer to be in range of other structures
          for (const maybeProtected of protectTiles) {
            const distanceSquared = mg.euclideanDistSquared(
              tile,
              maybeProtected,
            );
            if (distanceSquared > rangeSquared) continue;
            w += structureSpacing;
          }

          return w;
        };
      }
      default:
        throw new Error(`Value function not implemented for ${type}`);
    }
  }
}
