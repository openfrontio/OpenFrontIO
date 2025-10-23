import { Game, Gold, Player, UnitType } from "../../../game/Game";
import { PseudoRandom } from "../../../PseudoRandom";
import { Advisor, AdvisorDependencies } from "./types";

/**
 * Abstract base class for all strategic advisors
 * Provides common utilities and dependencies
 */
export abstract class BaseAdvisor implements Advisor {
  protected readonly game: Game;
  protected readonly player: Player;
  protected readonly random: PseudoRandom;

  constructor(deps: AdvisorDependencies) {
    this.game = deps.game;
    this.player = deps.player;
    this.random = deps.random;
  }

  /**
   * Calculate the cost of a unit type for the current player
   */
  protected cost(type: UnitType): Gold {
    return this.game.unitInfo(type).cost(this.player);
  }

  /**
   * Check if the player can afford a cost considering MIRV reserves
   * This will be properly implemented when MIRVAdvisor is created
   * For now, just check basic affordability
   */
  protected canAffordWithReserve(cost: Gold): boolean {
    // TODO: This will be enhanced when MIRVAdvisor is integrated
    return this.player.gold() >= cost;
  }

  /**
   * Abstract method that each advisor must implement
   */
  abstract recommend(): import("./types").ActionRecommendation | null;
}
