import { PlayerType, TerrainType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { GameStateAnalyzer } from "../analysis/GameStateAnalyzer";

export interface SpawnAnalysis {
  tile: TileRef;
  score: number;
  reasons: string[];
  landArea: number;
  nearbyPlayers: number;
  centerDistance: number;
  waterAccess: boolean;
  defensivePosition: boolean;
}

export interface SpawnDecision {
  selectedTile: TileRef;
  confidence: number; // 0-100
  analysis: SpawnAnalysis;
  alternatives: SpawnAnalysis[];
}

export class SpawnStrategy {
  constructor(
    private gameView: GameView,
    private gameStateAnalyzer: GameStateAnalyzer,
  ) {}

  public selectSpawnLocation(): SpawnDecision | null {
    if (!this.gameView.inSpawnPhase()) {
      console.warn("SpawnStrategy: Not in spawn phase");
      return null;
    }

    // Get all available spawn locations
    const availableSpawns = this.findAvailableSpawnLocations();
    if (availableSpawns.length === 0) {
      console.warn("SpawnStrategy: No available spawn locations found");
      return null;
    }

    // Analyze each potential spawn location
    const analyses = availableSpawns.map((tile) =>
      this.analyzeSpawnLocation(tile),
    );

    // Sort by score (highest first)
    analyses.sort((a, b) => b.score - a.score);

    const best = analyses[0];
    const alternatives = analyses.slice(1, 4); // Top 3 alternatives

    // Calculate confidence based on score difference
    const confidence = this.calculateConfidence(best, analyses);

    return {
      selectedTile: best.tile,
      confidence,
      analysis: best,
      alternatives,
    };
  }

  private findAvailableSpawnLocations(): TileRef[] {
    const available: TileRef[] = [];

    // Scan the entire map for available spawn locations
    for (let x = 0; x < this.gameView.width(); x++) {
      for (let y = 0; y < this.gameView.height(); y++) {
        const tile = this.gameView.ref(x, y);

        // Check if this tile is a valid spawn location
        if (this.isValidSpawnLocation(tile)) {
          available.push(tile);
        }
      }
    }

    return available;
  }

  private isValidSpawnLocation(tile: TileRef): boolean {
    // Must be land
    if (!this.gameView.isLand(tile)) {
      return false;
    }

    // Must not be owned by anyone
    if (this.gameView.hasOwner(tile)) {
      return false;
    }

    // Should not be immediately adjacent to other players (minimum distance)
    const nearbyPlayers = this.countNearbyPlayers(tile, 3);
    if (nearbyPlayers > 0) {
      return false; // Too close to other players
    }

    return true;
  }

  private analyzeSpawnLocation(tile: TileRef): SpawnAnalysis {
    const reasons: string[] = [];
    let score = 50; // Base score

    // 1. Land area analysis - how much connected land is available?
    const landArea = this.calculateConnectedLandArea(tile);
    const landAreaScore = Math.min(landArea / 100, 20); // Max 20 points for land area
    score += landAreaScore;
    if (landArea > 150) {
      reasons.push(`Large land area (${landArea} tiles)`);
    } else if (landArea < 50) {
      reasons.push(`Small land area (${landArea} tiles)`);
      score -= 10;
    }

    // 2. Distance from other players
    const nearbyPlayers = this.countNearbyPlayers(tile, 15);
    if (nearbyPlayers === 0) {
      score += 15;
      reasons.push("Isolated position - safe from early conflicts");
    } else if (nearbyPlayers === 1) {
      score += 5;
      reasons.push("One nearby player - manageable threat");
    } else {
      score -= nearbyPlayers * 3;
      reasons.push(`Multiple nearby players (${nearbyPlayers}) - high threat`);
    }

    // 3. Distance from map center (prefer not too central, not too edge)
    const centerDistance = this.calculateDistanceFromCenter(tile);
    const optimalDistance =
      Math.min(this.gameView.width(), this.gameView.height()) * 0.3;
    const centerScore = 10 - Math.abs(centerDistance - optimalDistance) / 5;
    score += Math.max(0, centerScore);
    if (centerDistance < optimalDistance * 0.5) {
      reasons.push("Too central - may attract early attention");
    } else if (centerDistance > optimalDistance * 1.5) {
      reasons.push("Too peripheral - limited expansion options");
    } else {
      reasons.push("Good distance from center");
    }

    // 4. Water access for naval operations
    const waterAccess = this.hasWaterAccess(tile, 5);
    if (waterAccess) {
      score += 8;
      reasons.push("Good water access for naval expansion");
    } else {
      score -= 5;
      reasons.push("Limited water access");
    }

    // 5. Defensive position analysis
    const defensivePosition = this.isDefensivePosition(tile);
    if (defensivePosition) {
      score += 10;
      reasons.push("Natural defensive advantages");
    }

    // 6. Avoid spawn locations too close to map edges
    const edgeDistance = this.calculateEdgeDistance(tile);
    if (edgeDistance < 5) {
      score -= 15;
      reasons.push("Too close to map edge - limited expansion");
    }

    // 7. Consider terrain variety in the area
    const terrainVariety = this.analyzeTerrainVariety(tile, 8);
    score += terrainVariety * 3;
    if (terrainVariety > 2) {
      reasons.push("Good terrain variety for diverse strategies");
    }

    return {
      tile,
      score: Math.max(0, Math.min(100, score)), // Clamp to 0-100
      reasons,
      landArea,
      nearbyPlayers,
      centerDistance,
      waterAccess,
      defensivePosition,
    };
  }

  private calculateConnectedLandArea(startTile: TileRef): number {
    const visited = new Set<TileRef>();
    const toVisit = [startTile];
    let area = 0;

    while (toVisit.length > 0 && area < 300) {
      // Limit search for performance
      const tile = toVisit.pop()!;
      if (visited.has(tile)) continue;

      visited.add(tile);
      if (!this.gameView.isLand(tile)) continue;

      area++;

      // Add neighbors
      const neighbors = this.gameView.neighbors(tile);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          toVisit.push(neighbor);
        }
      }
    }

    return area;
  }

  private countNearbyPlayers(tile: TileRef, radius: number): number {
    let count = 0;
    const x = this.gameView.x(tile);
    const y = this.gameView.y(tile);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;

        if (!this.gameView.isValidCoord(checkX, checkY)) continue;

        const checkTile = this.gameView.ref(checkX, checkY);
        if (this.gameView.hasOwner(checkTile)) {
          const owner = this.gameView.owner(checkTile);
          if (owner.isPlayer() && owner.type() !== PlayerType.Bot) {
            count++;
            break; // Count each player only once
          }
        }
      }
    }

    return count;
  }

  private calculateDistanceFromCenter(tile: TileRef): number {
    const x = this.gameView.x(tile);
    const y = this.gameView.y(tile);
    const centerX = this.gameView.width() / 2;
    const centerY = this.gameView.height() / 2;

    return Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
  }

  private hasWaterAccess(tile: TileRef, searchRadius: number): boolean {
    const x = this.gameView.x(tile);
    const y = this.gameView.y(tile);

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;

        if (!this.gameView.isValidCoord(checkX, checkY)) continue;

        const checkTile = this.gameView.ref(checkX, checkY);
        if (!this.gameView.isLand(checkTile)) {
          return true;
        }
      }
    }

    return false;
  }

  private isDefensivePosition(tile: TileRef): boolean {
    // A position is defensive if it has natural barriers (water, mountains)
    // or is in a peninsula/bay configuration
    const neighbors = this.gameView.neighbors(tile);
    const landNeighbors = neighbors.filter((n) => this.gameView.isLand(n));

    // If less than 6 land neighbors, it might be a defensive position
    return landNeighbors.length < 6;
  }

  private calculateEdgeDistance(tile: TileRef): number {
    const x = this.gameView.x(tile);
    const y = this.gameView.y(tile);

    const distToLeft = x;
    const distToRight = this.gameView.width() - 1 - x;
    const distToTop = y;
    const distToBottom = this.gameView.height() - 1 - y;

    return Math.min(distToLeft, distToRight, distToTop, distToBottom);
  }

  private analyzeTerrainVariety(tile: TileRef, radius: number): number {
    const terrainTypes = new Set<TerrainType>();
    const x = this.gameView.x(tile);
    const y = this.gameView.y(tile);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;

        if (!this.gameView.isValidCoord(checkX, checkY)) continue;

        const checkTile = this.gameView.ref(checkX, checkY);
        const terrain = this.gameView.terrainType(checkTile);
        terrainTypes.add(terrain);
      }
    }

    return terrainTypes.size;
  }

  private calculateConfidence(
    best: SpawnAnalysis,
    allAnalyses: SpawnAnalysis[],
  ): number {
    if (allAnalyses.length < 2) return 100;

    const secondBest = allAnalyses[1];
    const scoreDiff = best.score - secondBest.score;

    // Higher score difference means higher confidence
    return Math.min(100, Math.max(50, 50 + scoreDiff * 2));
  }

  // Utility method to get spawn recommendations as text
  public getSpawnRecommendations(): string[] {
    const decision = this.selectSpawnLocation();
    if (!decision) {
      return ["No suitable spawn locations found"];
    }

    const recommendations = [
      `Best spawn location: ${this.gameView.x(decision.selectedTile)}, ${this.gameView.y(decision.selectedTile)} (score: ${decision.analysis.score})`,
      `Confidence: ${decision.confidence}%`,
      ...decision.analysis.reasons,
    ];

    if (decision.alternatives.length > 0) {
      recommendations.push(
        `Alternative locations available with scores: ${decision.alternatives.map((a) => a.score).join(", ")}`,
      );
    }

    return recommendations;
  }
}
