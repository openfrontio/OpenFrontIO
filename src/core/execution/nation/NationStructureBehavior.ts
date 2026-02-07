import {
  Difficulty,
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
import { assertNever } from "../../Util";
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

/** SAM launcher ratio per city, keyed by difficulty */
const SAM_RATIO_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0.15,
  [Difficulty.Medium]: 0.2,
  [Difficulty.Hard]: 0.25,
  [Difficulty.Impossible]: 0.3,
};

/**
 * Returns structure ratios relative to city count, adjusted by difficulty.
 * Cities are always prioritized and built first.
 */
function getStructureRatios(
  difficulty: Difficulty,
): Partial<Record<UnitType, StructureRatioConfig>> {
  return {
    [UnitType.Port]: { ratioPerCity: 0.75, perceivedCostIncreasePerOwned: 1 },
    [UnitType.Factory]: {
      ratioPerCity: 0.75,
      perceivedCostIncreasePerOwned: 1,
    },
    [UnitType.DefensePost]: {
      ratioPerCity: 0.25,
      perceivedCostIncreasePerOwned: 1,
    },
    [UnitType.SAMLauncher]: {
      ratioPerCity: SAM_RATIO_BY_DIFFICULTY[difficulty],
      perceivedCostIncreasePerOwned: 1,
    },
    [UnitType.MissileSilo]: {
      ratioPerCity: 0.2,
      perceivedCostIncreasePerOwned: 1,
    },
  };
}

/** Perceived cost increase percentage per city owned */
const CITY_PERCEIVED_COST_INCREASE_PER_OWNED = 1;

/** Factory ratio multiplier when the nation has coastal tiles */
const FACTORY_COASTAL_RATIO_MULTIPLIER = 0.33;

/** Maximum number of missile silos a nation will build */
const MAX_MISSILE_SILOS = 3;

/** If we have more than this many structures per 1000 tiles, prefer upgrading over building */
const UPGRADE_DENSITY_THRESHOLD = 1 / 1500;

/** Maximum density of defense posts (per tile owned) before no more can be built */
const DEFENSE_POST_DENSITY_THRESHOLD = 1 / 5000;

export class NationStructureBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  handleStructures(): boolean {
    const cityCount = this.player.unitsOwned(UnitType.City);
    const hasCoastalTiles = this.hasCoastalTiles();

    // Build order for non-city structures (priority order)
    const buildOrder: UnitType[] = [
      UnitType.DefensePost,
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];

    const config = this.game.config();
    const nukesEnabled =
      !config.isUnitDisabled(UnitType.AtomBomb) ||
      !config.isUnitDisabled(UnitType.HydrogenBomb) ||
      !config.isUnitDisabled(UnitType.MIRV);
    const missileSilosEnabled = !config.isUnitDisabled(UnitType.MissileSilo);

    for (const structureType of buildOrder) {
      // Skip ports if no coastal tiles
      if (structureType === UnitType.Port && !hasCoastalTiles) {
        continue;
      }

      // Skip missile silos and SAM launchers if all nukes are disabled
      if (
        !nukesEnabled &&
        (structureType === UnitType.MissileSilo ||
          structureType === UnitType.SAMLauncher)
      ) {
        continue;
      }

      // Skip SAM launchers if missile silos are disabled
      if (!missileSilosEnabled && structureType === UnitType.SAMLauncher) {
        continue;
      }

      if (
        this.shouldBuildStructure(structureType, cityCount, hasCoastalTiles)
      ) {
        if (this.maybeSpawnStructure(structureType)) {
          return true;
        }
      }
    }

    if (this.maybeSpawnStructure(UnitType.City)) {
      return true;
    }

    return false;
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
    const { difficulty } = this.game.config().gameConfig();
    const ratios = getStructureRatios(difficulty);
    const config = ratios[type];
    if (config === undefined) {
      return false;
    }

    let ratio = config.ratioPerCity;

    // Heavily reduce factory spawning if we have coastal tiles
    if (type === UnitType.Factory && hasCoastalTiles) {
      ratio *= FACTORY_COASTAL_RATIO_MULTIPLIER;
    }

    const owned = this.player.unitsOwned(type);

    // Hard cap on missile silos
    if (type === UnitType.MissileSilo && owned >= MAX_MISSILE_SILOS) {
      return false;
    }

    // Density cap on defense posts (can't be upgraded so a new one would be built - problematic if it's a game with high starting gold)
    if (type === UnitType.DefensePost) {
      const tilesOwned = this.player.numTilesOwned();
      if (
        tilesOwned > 0 &&
        owned / tilesOwned >= DEFENSE_POST_DENSITY_THRESHOLD
      ) {
        return false;
      }
    }

    const targetCount = Math.floor(cityCount * ratio);

    return owned < targetCount;
  }

  private cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }

  private maybeSpawnStructure(type: UnitType): boolean {
    const perceivedCost = this.getPerceivedCost(type);
    if (this.player.gold() < perceivedCost) {
      return false;
    }

    // Check if we should upgrade instead of building new
    const structures = this.player.units(type);
    if (
      this.getTotalStructureDensity() > UPGRADE_DENSITY_THRESHOLD &&
      type !== UnitType.DefensePost
    ) {
      if (this.maybeUpgradeStructure(structures)) {
        return true;
      }
      // Density too high but couldn't upgrade (e.g. all under construction) — don't build new, wait for construction (most relevant for SAMs)
      if (structures.length > 0) {
        return false;
      }
      // No structures of this type exist yet — fall through to build the first one
      // (even if density is high - the nation is probably on a tiny island and we need to use all building spots we can find)
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    console.log(
      `[BUILD] nation=${this.player.name()} type=${type} realCost=${this.cost(type)} perceivedCost=${perceivedCost} gold=${this.player.gold()} owned=${this.player.unitsOwned(type)}`,
    );
    this.game.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  /**
   * Calculates the perceived cost for a structure type.
   * The perceived cost increases by a percentage for each structure of that type already owned.
   * This makes nations save up gold for nukes.
   * Once the nation can afford its target stockpile, stop inflating costs.
   */
  private getPerceivedCost(type: UnitType): Gold {
    const realCost = this.cost(type);

    const saveUpTarget = this.getSaveUpTarget();
    if (saveUpTarget === 0n || this.player.gold() >= saveUpTarget) {
      return realCost;
    }

    const owned = this.player.unitsOwned(type);

    let increasePerOwned: number;
    if (type === UnitType.City) {
      increasePerOwned = CITY_PERCEIVED_COST_INCREASE_PER_OWNED;
    } else {
      const { difficulty } = this.game.config().gameConfig();
      const ratios = getStructureRatios(difficulty);
      const config = ratios[type];
      increasePerOwned = config?.perceivedCostIncreasePerOwned ?? 0.1;
    }

    // Each owned structure makes the next one feel more expensive
    // Formula: realCost * (1 + increasePerOwned * owned)
    const multiplier = 1 + increasePerOwned * owned;
    return BigInt(Math.ceil(Number(realCost) * multiplier));
  }

  /**
   * Determines the gold target we want to save up for based on which nukes are enabled.
   * Returns 0 if no saving is needed.
   */
  private getSaveUpTarget(): Gold {
    const config = this.game.config();

    // No need to save up if missile silos are disabled
    if (config.isUnitDisabled(UnitType.MissileSilo)) {
      return 0n;
    }

    const mirvEnabled = !config.isUnitDisabled(UnitType.MIRV);
    const hydroEnabled = !config.isUnitDisabled(UnitType.HydrogenBomb);
    const atomEnabled = !config.isUnitDisabled(UnitType.AtomBomb);

    if (mirvEnabled) {
      // Save up for MIRV + Hydrogen Bomb
      return this.cost(UnitType.MIRV) + this.cost(UnitType.HydrogenBomb);
    }
    if (hydroEnabled) {
      // Save up for 5 hydrogen bombs
      return this.cost(UnitType.HydrogenBomb) * 5n;
    }
    if (atomEnabled) {
      // Save up for 20 atom bombs
      return this.cost(UnitType.AtomBomb) * 20n;
    }
    // No nukes enabled, no need to save up
    return 0n;
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
      console.log(
        `[UPGRADE] nation=${this.player.name()} type=${structureToUpgrade.type()} level=${structureToUpgrade.level()}→${structureToUpgrade.level() + 1} gold=${this.player.gold()} density=${this.getTotalStructureDensity().toFixed(6)}`,
      );
      this.game.addExecution(
        new UpgradeStructureExecution(this.player, structureToUpgrade.id()),
      );
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
   * In 50% of cases, picks the second or third best to add variety.
   */
  private findBestStructureToUpgrade(structures: Unit[]): Unit | null {
    if (structures.length === 0) {
      return null;
    }

    // Filter to only upgradable structures
    const upgradable = structures.filter((s) => this.player.canUpgradeUnit(s));
    if (upgradable.length === 0) {
      return null;
    }

    // Based on difficulty, chance to just pick a random structure
    const { difficulty } = this.game.config().gameConfig();
    let randomChance: number;
    switch (difficulty) {
      case Difficulty.Easy:
        randomChance = 70;
        break;
      case Difficulty.Medium:
        randomChance = 40;
        break;
      case Difficulty.Hard:
        randomChance = 25;
        break;
      case Difficulty.Impossible:
        randomChance = 10;
        break;
      default:
        assertNever(difficulty);
    }

    if (this.random.nextInt(0, 100) < randomChance) {
      return this.random.randElement(upgradable);
    }

    const samLaunchers = this.player.units(UnitType.SAMLauncher);

    // Score each structure based on SAM protection
    const scored: { structure: Unit; score: number }[] = [];

    for (const structure of structures) {
      if (!this.player.canUpgradeUnit(structure)) {
        continue;
      }

      let score = 0;

      // Check if protected by any SAM, using per-SAM level-based range
      for (const sam of samLaunchers) {
        const samRange = this.game.config().samRange(sam.level());
        const samRangeSquared = samRange * samRange;
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

      scored.push({ structure, score });
    }

    if (scored.length === 0) {
      return null;
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // 50% of the time, pick the second or third best for variety
    if (scored.length >= 2 && this.random.chance(2)) {
      const pickIndex =
        scored.length >= 3
          ? this.random.nextInt(1, 3) // pick index 1 or 2
          : 1; // only index 1 available
      return scored[pickIndex].structure;
    }

    return scored[0].structure;
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
    switch (type) {
      case UnitType.City:
      case UnitType.Factory:
      case UnitType.MissileSilo:
        return this.interiorStructureValue(type);
      case UnitType.Port:
        return this.portValue();
      case UnitType.DefensePost:
        return this.defensePostValue();
      case UnitType.SAMLauncher:
        return this.samLauncherValue();
      default:
        throw new Error(`Value function not implemented for ${type}`);
    }
  }

  /**
   * Value function for interior structures (City, Factory, MissileSilo).
   * Prefers high elevation, distance from border, and spacing from same-type structures.
   */
  private interiorStructureValue(type: UnitType): (tile: TileRef) => number {
    const game = this.game;
    const borderTiles = this.player.borderTiles();
    const otherUnits = this.player.units(type);
    const { borderSpacing, structureSpacing } = this.spacingConstants();

    return (tile) => {
      let w = 0;

      // Prefer higher elevations
      w += game.magnitude(tile);

      // Prefer to be away from the border
      const [, closestBorderDist] = closestTile(game, borderTiles, tile);
      w += Math.min(closestBorderDist, borderSpacing);

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      return w;
    };
  }

  /**
   * Value function for ports.
   * Prefers spacing from other ports.
   */
  private portValue(): (tile: TileRef) => number {
    const game = this.game;
    const otherUnits = this.player.units(UnitType.Port);
    const { structureSpacing } = this.spacingConstants();

    return (tile) => {
      let w = 0;

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const [, closestOtherDist] = closestTile(game, otherTiles, tile);
      w += Math.min(closestOtherDist, structureSpacing);

      return w;
    };
  }

  /**
   * Value function for defense posts.
   * Returns null if there are no hostile non-bot neighbors.
   * Prefers elevation, proximity to border with hostile neighbors, and spacing.
   */
  private defensePostValue(): ((tile: TileRef) => number) | null {
    const game = this.game;
    const player = this.player;
    const borderTiles = player.borderTiles();
    const otherUnits = player.units(UnitType.DefensePost);
    const { borderSpacing, structureSpacing } = this.spacingConstants();

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
      w += game.magnitude(tile);

      const [closest, closestBorderDist] = closestTile(game, borderTiles, tile);
      if (closest !== null) {
        // Prefer to be borderSpacing tiles from the border
        w += Math.max(
          0,
          borderSpacing - Math.abs(borderSpacing - closestBorderDist),
        );

        // Prefer adjacent players who are hostile
        const neighbors: Set<Player> = new Set();
        for (const neighborTile of game.neighbors(closest)) {
          if (!game.isLand(neighborTile)) continue;
          const id = game.ownerID(neighborTile);
          if (id === player.smallID()) continue;
          const neighbor = game.playerBySmallID(id);
          if (!neighbor.isPlayer()) continue;
          if (neighbor.type() === PlayerType.Bot) continue;
          neighbors.add(neighbor);
        }
        for (const neighbor of neighbors) {
          w += borderSpacing * (Relation.Friendly - player.relation(neighbor));
        }
      }

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      return w;
    };
  }

  /**
   * Value function for SAM launchers.
   * Prefers elevation, distance from border, spacing, and proximity to protectable structures.
   * On harder difficulties, weights by structure level and considers existing SAM coverage.
   */
  private samLauncherValue(): (tile: TileRef) => number {
    const game = this.game;
    const player = this.player;
    const borderTiles = player.borderTiles();
    const otherUnits = player.units(UnitType.SAMLauncher);
    const { borderSpacing, structureSpacing } = this.spacingConstants();

    const { difficulty } = game.config().gameConfig();
    const weightByLevel =
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;

    const protectEntries: { tile: TileRef; weight: number }[] = [];
    for (const unit of player.units()) {
      switch (unit.type()) {
        case UnitType.City:
        case UnitType.Factory:
        case UnitType.MissileSilo:
        case UnitType.Port:
          protectEntries.push({
            tile: unit.tile(),
            weight: weightByLevel ? unit.level() : 1,
          });
      }
    }
    const range = game.config().defaultSamRange();
    const rangeSquared = range * range;

    const useCoverageWeighting =
      difficulty !== Difficulty.Easy && this.random.nextInt(0, 100) < 25;

    // Pre-compute existing SAM coverage for each protectable structure
    let structureCoverage: Map<TileRef, number> | null = null;
    if (useCoverageWeighting) {
      structureCoverage = new Map<TileRef, number>();
      const existingSams = player.units(UnitType.SAMLauncher);
      for (const entry of protectEntries) {
        let coverageScore = 0;
        for (const sam of existingSams) {
          const samRange = game.config().samRange(sam.level());
          const dist = game.euclideanDistSquared(entry.tile, sam.tile());
          if (dist <= samRange * samRange) {
            coverageScore += sam.level();
          }
        }
        structureCoverage.set(entry.tile, coverageScore);
      }
    }

    return (tile) => {
      let w = 0;

      // Prefer higher elevations
      w += game.magnitude(tile);

      // Prefer to be away from the border
      const closestBorder = closestTwoTiles(game, borderTiles, [tile]);
      if (closestBorder !== null) {
        const d = game.manhattanDist(closestBorder.x, tile);
        w += Math.min(d, borderSpacing);
      }

      // Prefer to be away from other structures of the same type
      const otherTiles: Set<TileRef> = new Set(otherUnits.map((u) => u.tile()));
      otherTiles.delete(tile);
      const closestOther = closestTwoTiles(game, otherTiles, [tile]);
      if (closestOther !== null) {
        const d = game.manhattanDist(closestOther.x, tile);
        w += Math.min(d, structureSpacing);
      }

      // Prefer to be in range of other structures (skip on easy difficulty)
      if (difficulty !== Difficulty.Easy) {
        for (const entry of protectEntries) {
          const distanceSquared = game.euclideanDistSquared(tile, entry.tile);
          if (distanceSquared > rangeSquared) continue;
          if (useCoverageWeighting && structureCoverage !== null) {
            const coverage = structureCoverage.get(entry.tile) ?? 0;
            const coverageWeight = 1 / (1 + coverage);
            w += structureSpacing * entry.weight * coverageWeight;
          } else {
            w += structureSpacing * entry.weight;
          }
        }
      }

      return w;
    };
  }

  /** Shared spacing constants derived from atom bomb range. */
  private spacingConstants(): {
    borderSpacing: number;
    structureSpacing: number;
  } {
    const borderSpacing = this.game
      .config()
      .nukeMagnitudes(UnitType.AtomBomb).outer;
    return { borderSpacing, structureSpacing: borderSpacing * 2 };
  }
}
