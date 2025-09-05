import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { BotStatus, PlayerBot } from "../PlayerBot";

export interface BotIntegrationConfig {
  autoStart?: boolean;
}

export class BotIntegration {
  private bot: PlayerBot | null = null;
  private isInitialized = false;
  private tickInterval: number | null = null;

  constructor(
    private gameView: GameView,
    private eventBus: EventBus,
  ) {}

  /**
   * Initialize the bot with configuration
   */
  public initialize(config: BotIntegrationConfig = {}): void {
    if (this.isInitialized) {
      console.warn("Bot already initialized");
      return;
    }

    // Create the bot instance with single strategy
    this.bot = new PlayerBot(this.gameView, this.eventBus);
    this.isInitialized = true;

    console.log("Bot initialized with single strategy");

    // Auto-start if requested
    if (config.autoStart) {
      this.start();
    }
  }

  /**
   * Start the bot
   */
  public start(): void {
    if (!this.bot) {
      throw new Error("Bot not initialized. Call initialize() first.");
    }

    this.bot.enable();

    // Set up tick interval
    this.tickInterval = window.setInterval(async () => {
      if (this.bot && this.tickInterval !== null) {
        try {
          await this.bot.tick();
        } catch (error) {
          console.error("Bot tick error:", error);
        }
      }
    }, 100); // Run every 100ms, bot will throttle internally

    console.log("Bot started");
  }

  /**
   * Stop the bot
   */
  public stop(): void {
    console.log("Stopping bot...");

    if (this.bot) {
      console.log("Disabling bot instance");
      this.bot.disable();
    } else {
      console.log("No bot instance to disable");
    }

    if (this.tickInterval) {
      console.log("Clearing tick interval:", this.tickInterval);
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log("Tick interval cleared");
    } else {
      console.log("No tick interval to clear");
    }

    console.log("Bot stopped successfully");
  }

  /**
   * Get bot status
   */
  public getStatus(): BotStatus | null {
    return this.bot?.getStatus() ?? null;
  }

  /**
   * Force bot to make a decision on next tick
   */
  public forceTick(): void {
    if (!this.bot) {
      throw new Error("Bot not initialized");
    }

    this.bot.forceTick();
  }

  /**
   * Get detailed analysis for debugging
   */
  public getAnalysis() {
    return this.bot?.getAnalysis() ?? null;
  }

  /**
   * Check if bot is running
   */
  public isRunning(): boolean {
    const status = this.bot?.getStatus();
    const hasInterval = this.tickInterval !== null;
    console.log("Bot running check:", {
      isEnabled: status?.isEnabled,
      hasInterval,
      intervalId: this.tickInterval,
    });
    return status?.isEnabled ?? false;
  }

  /**
   * Cleanup when game ends
   */
  public cleanup(): void {
    this.stop();
    this.bot = null;
    this.isInitialized = false;
  }
}

// Global bot instance for easy access
let globalBotIntegration: BotIntegration | null = null;

/**
 * Initialize global bot integration
 */
export function initializeBotIntegration(
  gameView: GameView,
  eventBus: EventBus,
  config?: BotIntegrationConfig,
): BotIntegration {
  if (globalBotIntegration) {
    console.warn(
      "Bot integration already exists, cleaning up previous instance",
    );
    globalBotIntegration.cleanup();
  }

  globalBotIntegration = new BotIntegration(gameView, eventBus);
  globalBotIntegration.initialize(config);

  // Make bot accessible from browser console for debugging
  (window as any).openFrontBot = {
    start: () => globalBotIntegration?.start(),
    stop: () => globalBotIntegration?.stop(),
    status: () => globalBotIntegration?.getStatus(),
    analysis: () => globalBotIntegration?.getAnalysis(),
    forceTick: () => globalBotIntegration?.forceTick(),
    isRunning: () => globalBotIntegration?.isRunning(),
  };

  console.log(
    "Bot integration initialized. Use 'openFrontBot' in console to control the bot.",
  );

  return globalBotIntegration;
}

/**
 * Get the global bot integration instance
 */
export function getBotIntegration(): BotIntegration | null {
  return globalBotIntegration;
}
