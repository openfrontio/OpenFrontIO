import { Gold, PlayerType, Relation, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";

export interface TerritoryAnalysis {
  tilesOwned: number;
  borderTiles: number;
  defensiveStrength: number;
  expansionOpportunities: TileRef[];
  vulnerableBorders: TileRef[];
  largestClusterSize: number;
  islandCount: number;
}

export interface NeighborAnalysis {
  neighbors: Array<{
    player: PlayerView;
    relation: Relation;
    sharedBorderLength: number;
    relativeStrength: number; // -1 (much weaker) to 1 (much stronger)
    threatLevel: number; // 0-100
    allianceOpportunity: number; // 0-100
  }>;
  hostileNeighbors: PlayerView[];
  friendlyNeighbors: PlayerView[];
  neutralNeighbors: PlayerView[];
}

export interface ResourceAnalysis {
  gold: Gold;
  goldPerTick: number;
  population: number;
  workers: number;
  troops: number;
  targetTroopRatio: number;
  maxPopulation: number;
  populationGrowthRate: number;
  isResourceConstrained: boolean;
  recommendedTroopRatio: number;
}

export interface ThreatAnalysis {
  incomingAttacks: Array<{
    attacker: PlayerView;
    troops: number;
    estimatedArrivalTime: number;
    severity: "low" | "medium" | "high" | "critical";
  }>;
  nearbyHostileForces: Array<{
    player: PlayerView;
    estimatedTroops: number;
    distance: number;
  }>;
  isUnderAttack: boolean;
  defenseStrength: number;
  recommendedAction: "defend" | "retreat" | "counter" | "flee";
}

export interface UnitAnalysis {
  cities: number;
  ports: number;
  factories: number;
  defensiveStructures: number;
  offensiveUnits: number;
  navalUnits: number;
  nuclearCapability: boolean;
  productionCapacity: number;
  strategicValue: number;
}

export interface GameStateAnalysis {
  phase: "spawn" | "game";
  territory: TerritoryAnalysis;
  neighbors: NeighborAnalysis;
  resources: ResourceAnalysis;
  threats: ThreatAnalysis;
  units: UnitAnalysis;
  strategicPosition: "dominant" | "strong" | "stable" | "weak" | "critical";
  recommendations: string[];
}

export class GameStateAnalyzer {
  constructor(private gameView: GameView) {}

  public analyzeGameState(player: PlayerView): GameStateAnalysis {
    const territory = this.analyzeTerritory(player);
    const neighbors = this.analyzeNeighbors(player);
    const resources = this.analyzeResources(player);
    const threats = this.analyzeThreat(player);
    const units = this.analyzeUnits(player);

    const phase = this.determineGamePhase();
    const strategicPosition = this.assessStrategicPosition(
      territory,
      neighbors,
      resources,
      threats,
      units,
    );
    const recommendations = this.generateRecommendations(
      territory,
      neighbors,
      resources,
      threats,
      units,
      phase,
    );

    return {
      phase,
      territory,
      neighbors,
      resources,
      threats,
      units,
      strategicPosition,
      recommendations,
    };
  }

  public analyzeTerritory(player: PlayerView): TerritoryAnalysis {
    const tilesOwned = player.numTilesOwned();
    const borderTiles = this.countBorderTiles(player);
    const expansionOpportunities = this.findExpansionOpportunities(player);
    const vulnerableBorders = this.findVulnerableBorders(player);
    const defensiveStrength = this.calculateDefensiveStrength(player);

    // Analyze territory clustering
    const clusters = this.analyzeTerritorialClusters(player);
    const largestClusterSize = Math.max(...clusters.map((c) => c.size));
    const islandCount = clusters.length;

    return {
      tilesOwned,
      borderTiles,
      defensiveStrength,
      expansionOpportunities,
      vulnerableBorders,
      largestClusterSize,
      islandCount,
    };
  }

  public analyzeNeighbors(player: PlayerView): NeighborAnalysis {
    const neighbors: NeighborAnalysis["neighbors"] = [];
    const hostileNeighbors: PlayerView[] = [];
    const friendlyNeighbors: PlayerView[] = [];
    const neutralNeighbors: PlayerView[] = [];

    // Get all neighboring players
    const neighborPlayers = this.getNeighboringPlayers(player);

    for (const neighbor of neighborPlayers) {
      const relation = this.getRelation(player, neighbor);
      const sharedBorderLength = this.calculateSharedBorderLength(
        player,
        neighbor,
      );
      const relativeStrength = this.calculateRelativeStrength(player, neighbor);
      const threatLevel = this.calculateThreatLevel(player, neighbor);
      const allianceOpportunity = this.calculateAllianceOpportunity(
        player,
        neighbor,
      );

      neighbors.push({
        player: neighbor,
        relation,
        sharedBorderLength,
        relativeStrength,
        threatLevel,
        allianceOpportunity,
      });

      // Categorize neighbors
      if (relation <= Relation.Hostile) {
        hostileNeighbors.push(neighbor);
      } else if (
        relation >= Relation.Friendly ||
        this.isAllied(player, neighbor)
      ) {
        friendlyNeighbors.push(neighbor);
      } else {
        neutralNeighbors.push(neighbor);
      }
    }

    return {
      neighbors,
      hostileNeighbors,
      friendlyNeighbors,
      neutralNeighbors,
    };
  }

  public analyzeResources(player: PlayerView): ResourceAnalysis {
    const gold = player.gold();
    const population = player.population();
    const workers = player.workers();
    const troops = player.troops();
    const targetTroopRatio = player.targetTroopRatio();

    // Estimate rates (would need historical data for accuracy)
    const goldPerTick = this.estimateGoldPerTick(player);
    const maxPopulation = this.estimateMaxPopulation(player);
    const populationGrowthRate = this.estimatePopulationGrowthRate(player);

    const isResourceConstrained = this.isResourceConstrained(player);
    // Calculate troop ratio without circular dependencies
    const recommendedTroopRatio = this.calculateRecommendedTroopRatioSafe(
      player,
      isResourceConstrained,
    );

    return {
      gold,
      goldPerTick,
      population,
      workers,
      troops,
      targetTroopRatio,
      maxPopulation,
      populationGrowthRate,
      isResourceConstrained,
      recommendedTroopRatio,
    };
  }

  public analyzeThreat(player: PlayerView): ThreatAnalysis {
    const incomingAttacks = this.analyzeIncomingAttacks(player);
    const nearbyHostileForces = this.analyzeNearbyHostileForces(player);
    const isUnderAttack = incomingAttacks.length > 0;
    const defenseStrength = this.calculateDefenseStrength(player);
    const recommendedAction = this.determineRecommendedDefensiveAction(
      incomingAttacks,
      nearbyHostileForces,
      defenseStrength,
    );

    return {
      incomingAttacks,
      nearbyHostileForces,
      isUnderAttack,
      defenseStrength,
      recommendedAction,
    };
  }

  public analyzeUnits(player: PlayerView): UnitAnalysis {
    // This would require access to player's units
    // For now, we'll estimate based on available information
    return {
      cities: 0, // TODO: Count actual units when unit data is available
      ports: 0,
      factories: 0,
      defensiveStructures: 0,
      offensiveUnits: 0,
      navalUnits: 0,
      nuclearCapability: false,
      productionCapacity: 0,
      strategicValue: 0,
    };
  }

  // Helper methods (these would need to be implemented based on GameView API)

  private countBorderTiles(player: PlayerView): number {
    // TODO: Implement when border tile data is available
    return Math.floor(player.numTilesOwned() * 0.3); // Estimate
  }

  private findExpansionOpportunities(player: PlayerView): TileRef[] {
    // TODO: Analyze neighboring neutral/weak territories
    return [];
  }

  private findVulnerableBorders(player: PlayerView): TileRef[] {
    // TODO: Find border tiles with low defense/high enemy presence
    return [];
  }

  private calculateDefensiveStrength(player: PlayerView): number {
    // Simple calculation based on troops and territory
    const troopDensity = player.troops() / Math.max(player.numTilesOwned(), 1);
    return Math.min(troopDensity / 100, 1.0);
  }

  private analyzeTerritorialClusters(
    player: PlayerView,
  ): Array<{ size: number; center: TileRef }> {
    // TODO: Implement clustering algorithm
    return [{ size: player.numTilesOwned(), center: 0 }]; // Simplified
  }

  private getNeighboringPlayers(player: PlayerView): PlayerView[] {
    return this.gameView
      .players()
      .filter(
        (p) =>
          p.id() !== player.id() && p.isAlive() && p.type() !== PlayerType.Bot,
      );
  }

  private getRelation(player: PlayerView, other: PlayerView): Relation {
    // TODO: Get actual relation from player data
    return Relation.Neutral; // Default
  }

  private calculateSharedBorderLength(
    player: PlayerView,
    neighbor: PlayerView,
  ): number {
    // TODO: Calculate actual shared border
    return 5; // Estimate
  }

  private calculateRelativeStrength(
    player: PlayerView,
    neighbor: PlayerView,
  ): number {
    const playerStrength = player.troops() + player.numTilesOwned() * 10;
    const neighborStrength = neighbor.troops() + neighbor.numTilesOwned() * 10;

    if (neighborStrength === 0) return 1;

    const ratio = playerStrength / neighborStrength;
    return Math.max(-1, Math.min(1, (ratio - 1) * 2)); // Normalize to -1 to 1
  }

  private calculateThreatLevel(
    player: PlayerView,
    neighbor: PlayerView,
  ): number {
    const relativeStrength = this.calculateRelativeStrength(player, neighbor);
    const relation = this.getRelation(player, neighbor);

    if (relation >= Relation.Friendly) return 0;
    if (relativeStrength > 0.5) return 20; // We're much stronger
    if (relativeStrength < -0.5) return 80; // They're much stronger

    return 50; // Balanced threat
  }

  private calculateAllianceOpportunity(
    player: PlayerView,
    neighbor: PlayerView,
  ): number {
    const relation = this.getRelation(player, neighbor);
    if (relation <= Relation.Distrustful) return 10;
    if (relation >= Relation.Friendly) return 90;
    return 50;
  }

  private isAllied(player: PlayerView, other: PlayerView): boolean {
    // TODO: Check actual alliance status
    return false;
  }

  private estimateGoldPerTick(player: PlayerView): number {
    // More accurate gold calculation
    const workers = player.workers();
    const territories = player.numTilesOwned();
    const cities = player.units(UnitType.City).length;
    const factories = player.units(UnitType.Factory).length;
    const tradePorts = player.units(UnitType.Port).length;

    // Base gold per worker (affected by buildings)
    const goldPerWorker = 2 + factories * 0.5; // Factories boost worker efficiency
    const territoryBonus = territories * 0.3; // Small gold per territory
    const cityBonus = cities * 5; // Cities provide significant gold
    const tradeBonus = tradePorts * 3; // Ports enable trade

    return workers * goldPerWorker + territoryBonus + cityBonus + tradeBonus;
  }

  private estimateMaxPopulation(player: PlayerView): number {
    // Population capacity based on cities and territory
    const territories = player.numTilesOwned();
    const cities = player.units(UnitType.City).length;

    const basePopPerTerritory = 80;
    const popPerCity = 200; // Cities significantly increase population capacity

    return territories * basePopPerTerritory + cities * popPerCity;
  }

  private estimatePopulationGrowthRate(player: PlayerView): number {
    const current = player.population();
    const max = this.estimateMaxPopulation(player);
    const cities = player.units(UnitType.City).length;

    if (current >= max) return 0;

    const growthRatio = (max - current) / max;
    const cityBonus = cities * 2; // Cities boost growth rate
    const baseGrowth = 8;

    return Math.min(20, baseGrowth * growthRatio + cityBonus);
  }

  private isResourceConstrained(player: PlayerView): boolean {
    const gold = player.gold();
    const population = player.population();
    const troops = player.troops();
    const workers = player.workers();
    const goldPerTick = this.estimateGoldPerTick(player);

    // Adjusted constraints for high-troop strategy
    const goldConstraint = gold < 1000 || goldPerTick < 30; // More lenient gold requirements
    const populationConstraint = population < (troops + workers) * 1.1; // Tighter population constraint
    const troopOverPopulation = troops > population * 0.95; // Allow higher troop ratios
    const lowWorkers = workers < Math.max(5, troops * 0.15); // Fewer workers needed with high-troop strategy

    // Only constrained if multiple factors are problematic
    const constraintCount = [
      goldConstraint,
      populationConstraint,
      troopOverPopulation,
      lowWorkers,
    ].filter(Boolean).length;
    return constraintCount >= 2; // Need at least 2 constraints to be "constrained"
  }

  private calculateRecommendedTroopRatio(player: PlayerView): number {
    const phase = this.determineGamePhase();
    const neighbors = this.analyzeNeighbors(player);
    const resources = this.analyzeResources(player);

    // High military focus - minimum 80% troops at all times
    let baseRatio = 0.8; // Aggressive military default

    // Adjust for game phase (but never below 0.8)
    switch (phase) {
      case "spawn":
        baseRatio = 0.8; // Maintain high military even in spawn
        break;
      case "game":
        baseRatio = 0.85; // High military focus for main game
        break;
    }

    // Adjust for threats (only increases, never decreases below 0.8)
    const hostileCount = neighbors.hostileNeighbors.length;
    const threatAdjustment = Math.min(0.15, hostileCount * 0.03);

    // Resource constraint handling - only minor adjustments
    let resourceAdjustment = 0;
    if (resources.isResourceConstrained) {
      // Only reduce slightly if severely constrained, but never below 0.8
      const currentRatio = player.targetTroopRatio();
      if (currentRatio > 0.85) {
        resourceAdjustment = -0.02; // Very small reduction
      }
    } else {
      resourceAdjustment = 0.02; // Small boost when resources are good
    }

    // Calculate final ratio with 0.8 minimum
    const calculatedRatio = baseRatio + threatAdjustment + resourceAdjustment;
    const finalRatio = Math.max(0.8, Math.min(0.95, calculatedRatio));

    return finalRatio;
  }

  /**
   * Safe version that doesn't cause circular dependencies
   */
  private calculateRecommendedTroopRatioSafe(
    player: PlayerView,
    isResourceConstrained: boolean,
  ): number {
    const phase = this.determineGamePhase();

    // High military focus - minimum 80% troops at all times
    let baseRatio = 0.8; // Aggressive military default

    // Adjust for game phase (but never below 0.8)
    switch (phase) {
      case "spawn":
        baseRatio = 0.8; // Maintain high military even in spawn
        break;
      case "game":
        baseRatio = 0.85; // High military focus for main game
        break;
    }

    // Simple threat estimation without circular dependency
    // Just use a conservative estimate for now
    const threatAdjustment = 0.02; // Small conservative boost

    // Resource constraint handling - only minor adjustments
    let resourceAdjustment = 0;
    if (isResourceConstrained) {
      // Only reduce slightly if severely constrained, but never below 0.8
      const currentRatio = player.targetTroopRatio();
      if (currentRatio > 0.85) {
        resourceAdjustment = -0.02; // Very small reduction
      }
    } else {
      resourceAdjustment = 0.02; // Small boost when resources are good
    }

    // Calculate final ratio with 0.8 minimum
    const calculatedRatio = baseRatio + threatAdjustment + resourceAdjustment;
    const finalRatio = Math.max(0.8, Math.min(0.95, calculatedRatio));

    return finalRatio;
  }

  private analyzeIncomingAttacks(
    player: PlayerView,
  ): ThreatAnalysis["incomingAttacks"] {
    // TODO: Analyze actual incoming attacks
    return [];
  }

  private analyzeNearbyHostileForces(
    player: PlayerView,
  ): ThreatAnalysis["nearbyHostileForces"] {
    // TODO: Analyze hostile forces in proximity
    return [];
  }

  private calculateDefenseStrength(player: PlayerView): number {
    return this.calculateDefensiveStrength(player);
  }

  private determineRecommendedDefensiveAction(
    incomingAttacks: ThreatAnalysis["incomingAttacks"],
    nearbyHostileForces: ThreatAnalysis["nearbyHostileForces"],
    defenseStrength: number,
  ): ThreatAnalysis["recommendedAction"] {
    if (incomingAttacks.length === 0 && nearbyHostileForces.length === 0) {
      return "defend";
    }

    const totalThreat = incomingAttacks.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );
    if (totalThreat > defenseStrength * 2) {
      return "flee";
    } else if (totalThreat > defenseStrength * 1.2) {
      return "retreat";
    } else {
      return "defend";
    }
  }

  private determineGamePhase(): GameStateAnalysis["phase"] {
    if (this.gameView.inSpawnPhase()) return "spawn";
    return "game";
  }

  private assessStrategicPosition(
    territory: TerritoryAnalysis,
    neighbors: NeighborAnalysis,
    resources: ResourceAnalysis,
    threats: ThreatAnalysis,
    units: UnitAnalysis,
  ): GameStateAnalysis["strategicPosition"] {
    let score = 0;

    // Territory strength
    score += Math.min(territory.tilesOwned / 50, 1) * 30;
    score += Math.min(territory.defensiveStrength, 1) * 20;

    // Resource strength
    score += Math.min(resources.population / 10000, 1) * 25;
    score += resources.isResourceConstrained ? -15 : 15;

    // Threat assessment
    score += threats.isUnderAttack ? -20 : 10;
    score += neighbors.hostileNeighbors.length * -5;
    score += neighbors.friendlyNeighbors.length * 5;

    if (score >= 80) return "dominant";
    if (score >= 60) return "strong";
    if (score >= 40) return "stable";
    if (score >= 20) return "weak";
    return "critical";
  }

  private generateRecommendations(
    territory: TerritoryAnalysis,
    neighbors: NeighborAnalysis,
    resources: ResourceAnalysis,
    threats: ThreatAnalysis,
    units: UnitAnalysis,
    phase: GameStateAnalysis["phase"],
  ): string[] {
    const recommendations: string[] = [];

    if (phase === "spawn") {
      recommendations.push("Focus on selecting optimal spawn location");
    }

    if (resources.isResourceConstrained) {
      recommendations.push("Priority: Improve resource generation");
    }

    if (threats.isUnderAttack) {
      recommendations.push(`Immediate threat: ${threats.recommendedAction}`);
    }

    if (territory.expansionOpportunities.length > 0) {
      recommendations.push("Expansion opportunities available");
    }

    if (
      neighbors.hostileNeighbors.length > neighbors.friendlyNeighbors.length
    ) {
      recommendations.push("Consider diplomatic initiatives");
    }

    return recommendations;
  }
}
