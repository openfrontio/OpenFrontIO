import { Game, Player } from "../../../game/Game";
import { PseudoRandom } from "../../../PseudoRandom";

/**
 * Represents a recommended action from an advisor
 */
export interface ActionRecommendation {
  /** Function to execute the recommended action */
  execute: () => void;
  /** Score indicating how good this recommendation is (higher = better) */
  score: number;
  /** Priority level for this recommendation */
  priority: AdvisorPriority;
  /** Optional description for debugging */
  description?: string;
}

/**
 * Priority levels for advisor recommendations
 */
export enum AdvisorPriority {
  Critical = 0, // Must execute immediately (e.g., spawn phase)
  High = 1, // Important strategic actions (e.g., MIRV launch)
  Normal = 2, // Regular actions (e.g., building structures)
  Low = 3, // Optional actions (e.g., random boat attacks)
}

/**
 * Base interface for all strategic advisors
 */
export interface Advisor {
  /**
   * Analyze current game state and recommend an action
   * @returns ActionRecommendation if an action should be taken, null otherwise
   */
  recommend(): ActionRecommendation | null;
}

/**
 * Common dependencies shared by all advisors
 */
export interface AdvisorDependencies {
  game: Game;
  player: Player;
  random: PseudoRandom;
}
