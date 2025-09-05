import { EventBus } from "../../core/EventBus";
import { GameView, PlayerView } from "../../core/game/GameView";
import {
  GameStateAnalysis,
  GameStateAnalyzer,
} from "./analysis/GameStateAnalyzer";
import { BuildStrategy } from "./strategy/BuildStrategy";
import { SpawnStrategy } from "./strategy/SpawnStrategy";

import { ActionExecutor } from "./execution/ActionExecutor";

export interface BotStatus {
  isEnabled: boolean;
  isActive: boolean;
  currentPhase: "spawn" | "game";
  lastDecision: string;
  confidence: number;
  recommendations: string[];
}

/**
 * PlayerBot - Configured for High-Troop Military Strategy
 *
 * Strategic Focus:
 * - Maintains minimum 80% troop ratio at all times
 * - Prioritizes population and economic buildings to support large armies
 * - Aggressive defensive posture with enhanced border security
 * - Reduced resource constraint thresholds to enable military focus
 */
export class PlayerBot {
  private gameStateAnalyzer: GameStateAnalyzer;
  private spawnStrategy: SpawnStrategy;
  private buildStrategy: BuildStrategy;
  private actionExecutor: ActionExecutor;

  private isEnabled = false;
  private isActive = false;
  private lastTickProcessed = -1;
  private tickRate = 10; // Process every 10 ticks to avoid overwhelming the game

  private currentAnalysis: GameStateAnalysis | null = null;
  private lastDecision = "Bot initialized";
  private confidence = 0;

  constructor(
    private gameView: GameView,
    private eventBus: EventBus,
  ) {
    this.gameStateAnalyzer = new GameStateAnalyzer(gameView);
    this.spawnStrategy = new SpawnStrategy(gameView, this.gameStateAnalyzer);
    this.buildStrategy = new BuildStrategy(gameView);
    this.actionExecutor = new ActionExecutor(eventBus);

    console.log("PlayerBot initialized with single strategy");
  }

  /**
   * Enable the bot to start making decisions
   */
  public enable(): void {
    if (this.isEnabled) {
      console.warn("Bot is already enabled");
      return;
    }

    this.isEnabled = true;
    this.isActive = true;
    this.lastTickProcessed = this.gameView.ticks();

    console.log("PlayerBot enabled");
  }

  /**
   * Disable the bot from making decisions
   */
  public disable(): void {
    this.isEnabled = false;
    this.isActive = false;

    console.log("PlayerBot disabled");
  }

  /**
   * Main decision-making loop called on each game tick
   */
  public async tick(): Promise<void> {
    if (!this.isEnabled) {
      console.log("PlayerBot: tick() called but bot is disabled, skipping");
      return;
    }

    const currentTick = this.gameView.ticks();

    // Skip processing if not enough ticks have passed
    if (currentTick - this.lastTickProcessed < this.tickRate) {
      return;
    }

    try {
      this.isActive = true;
      this.lastTickProcessed = currentTick;

      const myPlayer = this.gameView.myPlayer();
      if (!myPlayer) {
        console.warn("PlayerBot: No player found");
        return;
      }

      // Handle spawn phase separately
      if (this.gameView.inSpawnPhase()) {
        this.handleSpawnPhase(myPlayer);
        return;
      }

      // Skip if player hasn't spawned yet
      if (!myPlayer.hasSpawned()) {
        console.error("PlayerBot: Player hasn't spawned");
        return;
      }

      // Handle main game phases
      await this.handleMainGame(myPlayer);
    } catch (error) {
      console.error("PlayerBot tick error:", error);
      this.lastDecision = `Error: ${error.message}`;
      this.confidence = 0;
    }
  }

  /**
   * Handle spawn phase decisions
   */
  private handleSpawnPhase(player: PlayerView): void {
    // Only try to spawn if we haven't spawned yet
    if (player.hasSpawned()) {
      return;
    }

    console.log("PlayerBot: Handling spawn phase");

    const spawnDecision = this.spawnStrategy.selectSpawnLocation();
    if (!spawnDecision) {
      this.lastDecision = "No suitable spawn location found";
      this.confidence = 0;
      return;
    }

    // Execute spawn decision
    this.actionExecutor.executeSpawn(spawnDecision.selectedTile);

    this.lastDecision = `Spawning at ${this.gameView.x(spawnDecision.selectedTile)}, ${this.gameView.y(spawnDecision.selectedTile)}`;
    this.confidence = spawnDecision.confidence;

    console.log(
      `PlayerBot: Spawning at (${this.gameView.x(spawnDecision.selectedTile)}, ${this.gameView.y(spawnDecision.selectedTile)}) with confidence ${spawnDecision.confidence}%`,
    );
    console.log("Spawn reasons:", spawnDecision.analysis.reasons);
  }

  /**
   * Handle main game phase decisions
   */
  private async handleMainGame(player: PlayerView): Promise<void> {
    // Analyze current game state
    this.currentAnalysis = this.gameStateAnalyzer.analyzeGameState(player);

    console.log(
      `PlayerBot: Game phase ${this.currentAnalysis.phase}, position ${this.currentAnalysis.strategicPosition}`,
    );

    // Make decisions based on priority
    await this.makeStrategicDecisions(player, this.currentAnalysis);
  }

  /**
   * Make strategic decisions based on current game state
   */
  private async makeStrategicDecisions(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): Promise<void> {
    // Priority 1: Handle immediate threats
    if (analysis.threats.isUnderAttack) {
      this.handleThreats(player, analysis);
      return;
    }

    // Priority 2: Resource management
    if (analysis.resources.isResourceConstrained) {
      this.handleResourceManagement(player, analysis);
      return;
    }

    // Priority 3: Building and infrastructure
    if (this.shouldBuild(analysis)) {
      await this.handleBuilding(player, analysis);
      return;
    }

    // Priority 4: Expansion and attacks
    if (this.shouldExpand(analysis)) {
      this.handleExpansion(player, analysis);
      return;
    }

    // Priority 5: Diplomacy
    if (this.shouldDoDiplomacy(analysis)) {
      this.handleDiplomacy(player, analysis);
      return;
    }

    // Default: Wait and observe
    this.lastDecision = "Monitoring situation";
    this.confidence = 50;
  }

  /**
   * Handle immediate threats
   */
  private handleThreats(player: PlayerView, analysis: GameStateAnalysis): void {
    this.lastDecision = `Handling threats: ${analysis.threats.recommendedAction}`;
    this.confidence = 80;

    // For now, just log the threat response
    // TODO: Implement specific threat responses (retreat, defend, counter-attack)
    console.log(
      "PlayerBot: Threat detected, recommended action:",
      analysis.threats.recommendedAction,
    );
  }

  /**
   * Handle resource management decisions
   */
  private handleResourceManagement(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): void {
    const recommendedRatio = analysis.resources.recommendedTroopRatio;
    const currentRatio = analysis.resources.targetTroopRatio;

    // Enforce minimum 80% troop ratio
    const enforcedRatio = Math.max(0.8, recommendedRatio);

    // Be more aggressive about adjusting troop ratios (smaller threshold)
    if (Math.abs(enforcedRatio - currentRatio) > 0.02) {
      this.actionExecutor.executeSetTroopRatio(enforcedRatio);
      this.lastDecision = `Adjusting troop ratio to ${enforcedRatio.toFixed(2)} (minimum 80% enforced)`;
      this.confidence = 80;

      // Log the military focus strategy
      if (enforcedRatio > recommendedRatio) {
        console.log(
          `PlayerBot: Enforcing minimum 80% troop ratio (was recommended ${recommendedRatio.toFixed(2)})`,
        );
      }
    } else if (currentRatio < 0.8) {
      // Force adjustment if somehow below 80%
      this.actionExecutor.executeSetTroopRatio(0.8);
      this.lastDecision = "Emergency troop ratio adjustment to 80% minimum";
      this.confidence = 90;
      console.log(
        "PlayerBot: Emergency adjustment - troop ratio was below 80% minimum",
      );
    } else {
      this.lastDecision = `High-troop strategy stable (${currentRatio.toFixed(2)})`;
      this.confidence = 70;
    }
  }

  /**
   * Determine if we should focus on building
   */
  private shouldBuild(analysis: GameStateAnalysis): boolean {
    // Build more aggressively to support high-troop strategy
    const hasGold = analysis.resources.gold > 3000n; // Lower gold threshold
    const notSeverelyConstrained = !analysis.resources.isResourceConstrained;
    const anyPhaseExceptSpawn = analysis.phase !== "spawn"; // Build in all phases except spawn

    // Always prioritize building if we need population support for high troops
    const needsPopulationSupport =
      analysis.resources.population < analysis.resources.troops * 1.3;

    return (
      (hasGold && notSeverelyConstrained && anyPhaseExceptSpawn) ||
      needsPopulationSupport
    );
  }

  /**
   * Handle building decisions
   */
  private async handleBuilding(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): Promise<void> {
    try {
      const buildRecommendations =
        await this.buildStrategy.getImmediateBuildRecommendations(
          player,
          analysis,
        );

      if (buildRecommendations.length > 0) {
        const topBuild = buildRecommendations[0];
        this.lastDecision = `Building ${topBuild.unitType} - ${topBuild.reasoning}`;
        this.confidence = Math.min(90, 50 + topBuild.priority);

        // Execute the building decision
        this.actionExecutor.executeBuild(topBuild);

        console.log(
          `PlayerBot: Building ${topBuild.unitType} at priority ${topBuild.priority}: ${topBuild.reasoning}`,
        );
      } else {
        this.lastDecision = "No profitable buildings available";
        this.confidence = 40;
      }
    } catch (error) {
      console.warn("PlayerBot: Error in building analysis:", error);
      this.lastDecision = "Building analysis failed";
      this.confidence = 30;
    }
  }

  /**
   * Handle expansion decisions
   */
  private handleExpansion(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): void {
    // Simple expansion logic: attack neutral territory
    if (analysis.territory.expansionOpportunities.length > 0) {
      // For now, just indicate expansion opportunity
      this.lastDecision = `Expansion opportunity available (${analysis.territory.expansionOpportunities.length} targets)`;
      this.confidence = 65;

      // TODO: Implement actual attack logic
      console.log(
        "PlayerBot: Expansion opportunities found:",
        analysis.territory.expansionOpportunities.length,
      );
    } else {
      this.lastDecision = "No expansion opportunities";
      this.confidence = 40;
    }
  }

  /**
   * Handle diplomacy decisions
   */
  private handleDiplomacy(
    player: PlayerView,
    analysis: GameStateAnalysis,
  ): void {
    const allianceOpportunities = analysis.neighbors.neighbors.filter(
      (n) => n.allianceOpportunity > 70 && !player.isAlliedWith(n.player),
    );

    if (allianceOpportunities.length > 0) {
      this.lastDecision = `Alliance opportunities available (${allianceOpportunities.length} candidates)`;
      this.confidence = 60;

      // TODO: Implement alliance request logic
      console.log(
        "PlayerBot: Alliance opportunities:",
        allianceOpportunities.map((n) => n.player.name()),
      );
    } else {
      this.lastDecision = "No diplomatic actions needed";
      this.confidence = 50;
    }
  }

  /**
   * Determine if bot should focus on expansion
   */
  private shouldExpand(analysis: GameStateAnalysis): boolean {
    return (
      !analysis.threats.isUnderAttack &&
      !analysis.resources.isResourceConstrained &&
      analysis.strategicPosition !== "critical" &&
      analysis.territory.expansionOpportunities.length > 0
    );
  }

  /**
   * Determine if bot should focus on diplomacy
   */
  private shouldDoDiplomacy(analysis: GameStateAnalysis): boolean {
    return (
      analysis.neighbors.hostileNeighbors.length >
        analysis.neighbors.friendlyNeighbors.length &&
      analysis.phase !== "spawn"
    );
  }

  /**
   * Get current bot status for UI display
   */
  public getStatus(): BotStatus {
    return {
      isEnabled: this.isEnabled,
      isActive: this.isActive,
      currentPhase: this.currentAnalysis?.phase ?? "spawn",
      lastDecision: this.lastDecision,
      confidence: this.confidence,
      recommendations: this.currentAnalysis?.recommendations ?? [],
    };
  }

  /**
   * Get detailed analysis for debugging
   */
  public getAnalysis(): GameStateAnalysis | null {
    return this.currentAnalysis;
  }

  /**
   * Force bot to make a decision on next tick
   */
  public forceTick(): void {
    this.lastTickProcessed = this.gameView.ticks() - this.tickRate;
  }
}
