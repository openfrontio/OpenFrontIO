import { BuildableUnit, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { GameStateAnalysis } from "../analysis/GameStateAnalyzer";

export interface BuildDecision {
  tile: TileRef;
  unitType: UnitType;
  priority: number;
  reasoning: string;
  canUpgrade: number | false;
  existingUnitId?: number;
  cost: bigint;
}

export interface BuildAnalysis {
  recommendations: BuildDecision[];
  totalCost: bigint;
  immediateBuilds: BuildDecision[];
  futureBuilds: BuildDecision[];
}

export class BuildStrategy {
  constructor(private gameView: GameView) {}

  /**
   * Analyze and recommend buildings for a player
   */
  public async analyzeBuildingNeeds(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): Promise<BuildAnalysis> {
    const recommendations: BuildDecision[] = [];
    const playerGold = player.gold();

    // Get player's border tiles as a starting point for building analysis
    const borderData = await player.borderTiles();
    const borderTiles = Array.from(borderData.borderTiles);

    // For now, focus on border tiles as they're strategic for building
    // TODO: Expand to include all player tiles if needed
    for (const tile of borderTiles) {
      const actions = await player.actions(tile);
      const buildableUnits = actions.buildableUnits;

      for (const buildable of buildableUnits) {
        const decision = this.evaluateBuildingOption(
          player,
          tile,
          buildable,
          analysis,
        );
        if (decision) {
          recommendations.push(decision);
        }
      }
    }

    // Sort by priority (highest first)
    recommendations.sort((a, b) => b.priority - a.priority);

    // Separate immediate builds (affordable) from future builds
    let runningCost = BigInt(0);
    const immediateBuilds: BuildDecision[] = [];
    const futureBuilds: BuildDecision[] = [];

    for (const build of recommendations) {
      if (runningCost + build.cost <= playerGold) {
        immediateBuilds.push(build);
        runningCost += build.cost;
      } else {
        futureBuilds.push(build);
      }
    }

    return {
      recommendations,
      totalCost: recommendations.reduce(
        (sum, build) => sum + build.cost,
        BigInt(0),
      ),
      immediateBuilds,
      futureBuilds,
    };
  }

  /**
   * Evaluate a specific building option
   */

  private readonly buildable = [
    UnitType.City,
    // UnitType.Factory,
    UnitType.Port,
    UnitType.DefensePost,
    UnitType.SAMLauncher,
    UnitType.MissileSilo,
  ];

  private evaluateBuildingOption(
    player: PlayerView,
    tile: TileRef,
    buildable: BuildableUnit,
    analysis: GameStateAnalysis,
  ): BuildDecision | null {
    const { type, cost, canBuild, canUpgrade } = buildable;

    if (!this.buildable.includes(type)) {
      return null;
    }

    if (!canBuild) return null;

    const priority = this.calculateBuildPriority(
      player,
      canBuild,
      type,
      analysis,
    );
    if (priority <= 0) return null;

    const reasoning = `Building ${type} for strategic value`;

    return {
      tile: canBuild, // Use the actual valid build location, not the analyzed tile
      unitType: type,
      priority,
      reasoning,
      canUpgrade,
      existingUnitId: typeof canUpgrade === "number" ? canUpgrade : undefined,
      cost,
    };
  }

  /**
   * Calculate build priority for a unit type at a specific location
   */
  private calculateBuildPriority(
    player: PlayerView,
    tile: TileRef,
    unitType: UnitType,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 0;

    switch (unitType) {
      case UnitType.City:
        priority = this.evaluateCityPriority(player, tile, analysis);
        break;
      case UnitType.Factory:
        priority = this.evaluateFactoryPriority(player, tile, analysis);
        break;
      case UnitType.Port:
        priority = this.evaluatePortPriority(player, tile, analysis);
        break;
      case UnitType.DefensePost:
        priority = this.evaluateDefensePriority(player, tile, analysis);
        break;
      case UnitType.SAMLauncher:
        priority = this.evaluateSAMPriority(player, tile, analysis);
        break;
      case UnitType.MissileSilo:
        priority = this.evaluateMissileSiloPriority(player, tile, analysis);
        break;
      default:
        priority = 10; // Low default priority for other units
    }

    // Apply expansion rate modifier (hardcoded aggressive strategy)
    priority *= 1.2; // 120% expansion rate for aggressive building

    return Math.max(0, priority);
  }

  /**
   * Evaluate priority for building a city
   */
  private evaluateCityPriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 70; // Higher base priority for high-troop strategy

    // CRITICAL: High-troop strategy needs population support
    const troopToPopRatio =
      analysis.resources.troops / Math.max(1, analysis.resources.population);
    if (troopToPopRatio > 0.75) {
      priority += 60; // Massive boost if troops are consuming too much population
    }

    // Higher priority if population constrained
    if (analysis.resources.populationGrowthRate < 8) {
      priority += 50; // Increased from 40
    }

    // Higher priority if low gold income (troops need funding)
    if (analysis.resources.goldPerTick < 120) {
      priority += 40; // Increased from 30
    }

    // Always important for military strategy during main game
    if (analysis.phase === "game") {
      priority += 35; // Increased from 25
    }

    // Higher priority if we have few cities
    const existingCities = player.units(UnitType.City).length;
    const territories = player.numTilesOwned();
    const cityRatio = existingCities / Math.max(1, territories / 10);

    if (cityRatio < 0.5) {
      priority += 35;
    }

    // Strategic location bonus
    const neighbors = this.gameView.neighbors(tile);
    const borderNeighbors = neighbors.filter(
      (neighbor) =>
        this.gameView.hasOwner(neighbor) &&
        this.gameView.ownerID(neighbor) !== player.smallID(),
    );

    if (borderNeighbors.length > 0) {
      priority += 15; // Cities on borders are valuable
    }

    return priority;
  }

  /**
   * Evaluate priority for building a factory
   */
  private evaluateFactoryPriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 30; // Base priority

    // Higher priority if we have workers but low gold income
    const workers = player.workers();
    const goldPerTick = analysis.resources.goldPerTick;

    if (workers > 100 && goldPerTick < workers * 2) {
      priority += 40;
    }

    // Higher priority during main game
    if (analysis.phase === "game") {
      priority += 25;
    }

    // Higher priority if we have few factories
    const existingFactories = player.units(UnitType.Factory).length;
    const workers_per_factory = workers / Math.max(1, existingFactories);

    if (workers_per_factory > 200) {
      priority += 30;
    }

    return priority;
  }

  /**
   * Evaluate priority for building a port
   */
  private evaluatePortPriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 20; // Base priority

    // Only build ports on water-adjacent tiles
    const neighbors = this.gameView.neighbors(tile);
    const hasWaterAccess = neighbors.some(
      (neighbor) => !this.gameView.isLand(neighbor),
    );

    if (!hasWaterAccess) {
      return 0; // Can't build ports without water access
    }

    // Higher priority if we have no ports yet
    const existingPorts = player.units(UnitType.Port).length;
    if (existingPorts === 0) {
      priority += 50;
    }

    // Higher priority if we have significant territory (rough estimate)
    const territorySize = player.numTilesOwned();
    if (territorySize > 20) {
      priority += 20; // Assume larger territories are more likely to need ports
    }

    // Strategic value for naval operations during main game
    if (analysis.phase === "game") {
      priority += 15;
    }

    return priority;
  }

  /**
   * Evaluate priority for building defenses
   */
  private evaluateDefensePriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 30; // Higher base priority for aggressive military strategy

    // High-troop strategy benefits from defensive infrastructure
    priority += 20; // Always add military strategy bonus

    // Higher priority if under threat
    if (analysis.threats.isUnderAttack) {
      priority += 70; // Increased from 60
    }

    // Higher priority on border tiles
    const neighbors = this.gameView.neighbors(tile);
    const borderNeighbors = neighbors.filter(
      (neighbor) =>
        this.gameView.hasOwner(neighbor) &&
        this.gameView.ownerID(neighbor) !== player.smallID(),
    );

    if (borderNeighbors.length > 0) {
      priority += 40; // Increased from 30
    }

    // Higher priority near hostile neighbors
    if (analysis.neighbors.hostileNeighbors.length > 0) {
      priority += 35; // Increased from 25
    }

    // Even in peaceful games, military strategy values defenses
    if (
      analysis.neighbors.hostileNeighbors.length === 0 &&
      !analysis.threats.isUnderAttack
    ) {
      priority += 10; // Changed from -15 to +10 - always value defenses
    }

    return priority;
  }

  /**
   * Evaluate priority for SAM launchers
   */
  private evaluateSAMPriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 5; // Base priority

    // Only relevant during main game when nukes become a threat
    if (analysis.phase === "spawn") {
      return 0;
    }

    // Higher priority during main game when enemies might have nukes
    if (analysis.phase === "game") {
      priority += 30;
    }

    // Higher priority near important assets (cities, factories)
    const neighbors = this.gameView.neighbors(tile);
    const hasImportantNeighbor = neighbors.some((neighbor) => {
      if (
        !this.gameView.hasOwner(neighbor) ||
        this.gameView.ownerID(neighbor) !== player.smallID()
      ) {
        return false;
      }
      // Check if neighbor has important buildings
      // This would require additional game state analysis
      return false; // Simplified for now
    });

    if (hasImportantNeighbor) {
      priority += 20;
    }

    return priority;
  }

  /**
   * Evaluate priority for missile silos
   */
  private evaluateMissileSiloPriority(
    player: PlayerView,
    tile: TileRef,
    analysis: GameStateAnalysis,
  ): number {
    let priority = 20; // Base priority

    // Only relevant during main game for nuclear capabilities
    if (analysis.phase !== "game") {
      return 0;
    }

    // Aggressive strategy - always prioritize nuclear capabilities

    // Higher priority if we have hostile neighbors
    if (analysis.neighbors.hostileNeighbors.length > 0) {
      priority += 20;
    }

    // Lower priority if we already have missile capabilities
    const existingSilos = player.units(UnitType.MissileSilo).length;
    if (existingSilos > 0) {
      priority -= 15;
    }

    return priority;
  }

  /**
   * Get optimal build recommendations for immediate execution
   */
  public async getImmediateBuildRecommendations(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): Promise<BuildDecision[]> {
    const buildAnalysis = await this.analyzeBuildingNeeds(player, analysis);

    // Return top 3 immediate builds or all if fewer
    return buildAnalysis.immediateBuilds.slice(0, 3);
  }
}
